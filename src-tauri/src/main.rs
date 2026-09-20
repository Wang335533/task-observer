#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufRead, BufReader, Write}, path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio}, sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex}};
use tauri::{Manager, menu::{Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState}};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::oneshot;

type Reply = Result<Value, String>;
struct Bridge {
    input: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    counter: AtomicU64,
    error: Mutex<Option<String>>,
}

impl Bridge {
    fn new() -> Self {
        Self { input: Mutex::new(None), child: Mutex::new(None), pending: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(1), error: Mutex::new(None) }
    }

    fn shutdown(&self) {
        // Closing only our collector's stdin allows it to exit. Business processes
        // have never been started by this application and are never terminated.
        self.input.lock().unwrap().take();
        let child = self.child.lock().unwrap().take();
        if let Some(mut child) = child {
            std::thread::spawn(move || { let _ = child.wait(); });
        }
    }
}

#[tauri::command]
async fn collector_request(method: String, params: Value, bridge: tauri::State<'_, Arc<Bridge>>) -> Reply {
    let allowed = ["snapshot", "detail", "history", "logs", "save_task", "set_notifications", "acknowledge"];
    if !allowed.contains(&method.as_str()) { return Err("不支持的操作".into()); }
    if let Some(error) = bridge.error.lock().unwrap().as_ref() { return Err(error.clone()); }
    let id = bridge.counter.fetch_add(1, Ordering::SeqCst);
    let (sender, receiver) = oneshot::channel();
    bridge.pending.lock().unwrap().insert(id, sender);
    let message = format!("{}\n", json!({"id":id,"method":method,"params":params}));
    let write_result = {
        let mut input = bridge.input.lock().unwrap();
        match input.as_mut() {
            Some(stream) => stream.write_all(message.as_bytes()).and_then(|_| stream.flush()).map_err(|e| e.to_string()),
            None => Err("本地采集器尚未连接".into()),
        }
    };
    if let Err(error) = write_result { bridge.pending.lock().unwrap().remove(&id); return Err(error); }
    match tokio::time::timeout(std::time::Duration::from_secs(15), receiver).await {
        Ok(Ok(reply)) => reply,
        _ => { bridge.pending.lock().unwrap().remove(&id); Err("采集器响应超时；业务任务不受影响".into()) }
    }
}

fn collector_path() -> PathBuf {
    let beside = std::env::current_exe().unwrap().parent().unwrap().join("task-observer-collector.exe");
    if beside.exists() { return beside; }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/task-observer-collector-x86_64-pc-windows-msvc.exe")
}

fn start_collector(app: &tauri::AppHandle, bridge: Arc<Bridge>) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = std::env::var_os("TASK_OBSERVER_DATA_DIR").map(PathBuf::from)
        .unwrap_or(app.path().app_local_data_dir()?);
    std::fs::create_dir_all(&data_dir)?;
    let mut command = Command::new(collector_path());
    command.args(["--data-dir", &data_dir.to_string_lossy()]);
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn()?;
    let output = child.stdout.take().unwrap();
    *bridge.input.lock().unwrap() = child.stdin.take();
    *bridge.child.lock().unwrap() = Some(child);
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if let Ok(message) = serde_json::from_str::<Value>(&line) {
                if let Some(id) = message.get("id").and_then(Value::as_u64) {
                    if let Some(sender) = bridge.pending.lock().unwrap().remove(&id) {
                        let result = if let Some(error) = message.get("error").and_then(Value::as_str) {
                            Err(error.to_string())
                        } else { Ok(message.get("result").cloned().unwrap_or(Value::Null)) };
                        let _ = sender.send(result);
                    }
                } else if message.get("type").and_then(Value::as_str) == Some("notification") {
                    let title = message.get("title").and_then(Value::as_str).unwrap_or("任务观测台");
                    let body = message.get("body").and_then(Value::as_str).unwrap_or("有任务需要关注");
                    let _ = handle.notification().builder().title(title).body(body).show();
                }
            }
        }
        let error = "本地采集器已断开，请退出并重新打开应用；业务任务不受影响".to_string();
        *bridge.error.lock().unwrap() = Some(error.clone());
        for (_, sender) in bridge.pending.lock().unwrap().drain() { let _ = sender.send(Err(error.clone())); }
    });
    Ok(())
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus(); }
}

fn main() {
    let bridge = Arc::new(Bridge::new());
    let exit_bridge = bridge.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_window(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .manage(bridge.clone())
        .invoke_handler(tauri::generate_handler![collector_request])
        .setup(move |app| {
            let directory = std::env::var_os("TASK_OBSERVER_DATA_DIR").map(PathBuf::from)
                .unwrap_or(app.path().app_local_data_dir()?);
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("任务观测台").inner_size(1440.0, 960.0).min_inner_size(780.0, 620.0)
                .center().data_directory(directory.join("webview"))
                .visible(!std::env::args().any(|a| a == "--minimized")).build()?;
            if let Err(error) = start_collector(app.handle(), bridge.clone()) {
                *bridge.error.lock().unwrap() = Some(format!("无法启动本地采集器：{error}"));
            }
            let open = MenuItem::with_id(app, "open", "打开任务观测台", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出（停止监控）", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone()).tooltip("任务观测台 · 只读监控")
                .menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_window(app),
                    "quit" => { app.state::<Arc<Bridge>>().shutdown(); app.exit(0); }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) { show_window(tray.app_handle()); }
                }).build(app)?;
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = window.hide(); }
        })
        .build(tauri::generate_context!()).expect("无法初始化任务观测台")
        .run(move |_, event| { if let tauri::RunEvent::Exit = event { exit_bridge.shutdown(); } });
}
