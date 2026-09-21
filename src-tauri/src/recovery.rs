use std::{sync::{Arc, atomic::Ordering}, time::{Duration, Instant}};
use serde_json::json;
use tauri_plugin_notification::NotificationExt;
use crate::{Bridge, bridge_request, start_collector};

const HEALTH_SECONDS: u64 = 300;
const MAX_ATTEMPTS: u32 = 3;

fn is_healthy(value: &serde_json::Value) -> bool {
    value["sample_age"].as_f64().is_some_and(|age| age <= 900.0)
        && value["readers_overdue"].as_bool() == Some(false)
}

fn retry_delay(attempt: u32) -> Duration {
    Duration::from_secs(HEALTH_SECONDS * (1 << attempt.saturating_sub(1).min(2)))
}

fn record(app: &tauri::AppHandle, phase: &str, attempts: u32) {
    if let Ok(directory) = crate::data_directory(app) {
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map(|v| v.as_secs()).unwrap_or(0);
        let _ = std::fs::write(directory.join("collector-health.json"),
                              json!({"phase":phase,"attempts":attempts,"at":at}).to_string());
    }
}

fn close_owned_collector(bridge: &Bridge) -> Result<(), String> {
    bridge.generation.fetch_add(1, Ordering::SeqCst);
    bridge.input.lock().unwrap().take();
    for (_, sender) in bridge.pending.lock().unwrap().drain() {
        let _ = sender.send(Err("采集器正在恢复，请稍后重试".into()));
    }
    let child = bridge.child.lock().unwrap().take();
    if let Some(mut child) = child {
        let deadline = Instant::now() + Duration::from_secs(50);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline && !bridge.shutting_down.load(Ordering::SeqCst) => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                _ => {
                    // Never create a second collector while the first may still be alive.
                    *bridge.child.lock().unwrap() = Some(child);
                    return Err("旧采集器尚未退出，暂不创建新实例；业务任务不受影响".into());
                }
            }
        }
    }
    Ok(())
}

pub fn start(app: tauri::AppHandle, bridge: Arc<Bridge>) {
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(HEALTH_SECONDS));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        timer.tick().await;
        let mut attempts = 0;
        let mut check = 0_u64;
        let mut next_attempt_check = 0_u64;
        record(&app, "monitoring", attempts);
        loop {
            timer.tick().await;
            check += 1;
            if bridge.shutting_down.load(Ordering::SeqCst) { break; }
            if attempts >= MAX_ATTEMPTS { continue; }
            let health = bridge_request(&bridge, "ping", json!({})).await;
            let healthy = health.as_ref().is_ok_and(is_healthy);
            if let Ok(value) = health {
                bridge.notifications.store(value["notifications"].as_bool().unwrap_or(true), Ordering::SeqCst);
            }
            if healthy {
                attempts = 0;
                record(&app, "healthy", attempts);
                continue;
            }
            if check < next_attempt_check { continue; }
            attempts += 1;
            *bridge.error.lock().unwrap() = Some(format!("采集器正在自动恢复（第 {attempts}/{MAX_ATTEMPTS} 次）；业务任务不受影响"));
            record(&app, "recovering", attempts);
            let owned = bridge.clone();
            let stopped = tauri::async_runtime::spawn_blocking(move || close_owned_collector(&owned)).await;
            if bridge.shutting_down.load(Ordering::SeqCst) { break; }
            let result = match stopped {
                Ok(Ok(())) => start_collector(&app, bridge.clone()).map_err(|e| e.to_string()),
                Ok(Err(error)) => Err(error),
                Err(_) => Err("无法安全恢复采集器".into()),
            };
            if let Err(error) = result { *bridge.error.lock().unwrap() = Some(error); }
            next_attempt_check = check + retry_delay(attempts).as_secs() / HEALTH_SECONDS;
            record(&app, "awaiting_health", attempts);
            // The last launch gets one full health interval to prove it is alive.
            if attempts == MAX_ATTEMPTS {
                timer.tick().await;
                if bridge.shutting_down.load(Ordering::SeqCst) { break; }
                let last = bridge_request(&bridge, "ping", json!({})).await;
                if last.as_ref().is_ok_and(is_healthy) {
                    attempts = 0;
                    record(&app, "healthy", attempts);
                    continue;
                }
                *bridge.error.lock().unwrap() = Some("采集器连续恢复失败，已暂停自动重试；请退出并重新打开仪表盘。业务任务不受影响".into());
                record(&app, "needs_attention", attempts);
                if bridge.notifications.load(Ordering::SeqCst) {
                    let _ = app.notification().builder().title("任务观测台采集器需要处理")
                        .body("连续自动恢复失败，请退出并重新打开仪表盘；业务任务不受影响。" ).show();
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fresh_resources_do_not_hide_stuck_readers() {
        assert!(is_healthy(&json!({"sample_age": 1, "readers_overdue": false})));
        assert!(!is_healthy(&json!({"sample_age": 1, "readers_overdue": true})));
        assert!(!is_healthy(&json!({"sample_age": 901, "readers_overdue": false})));
    }
    #[test]
    fn retries_back_off_and_are_bounded() {
        assert_eq!(MAX_ATTEMPTS, 3);
        assert_eq!(retry_delay(1).as_secs(), 300);
        assert_eq!(retry_delay(2).as_secs(), 600);
        assert_eq!(retry_delay(3).as_secs(), 1200);
    }
    #[test]
    fn stopping_without_a_child_is_safe_and_cancels_pending_requests() {
        let bridge = Bridge::new();
        let (sender, mut receiver) = tokio::sync::oneshot::channel();
        bridge.pending.lock().unwrap().insert(1, sender);
        assert!(close_owned_collector(&bridge).is_ok());
        assert!(receiver.try_recv().unwrap().is_err());
        assert!(bridge.child.lock().unwrap().is_none());
    }
}
