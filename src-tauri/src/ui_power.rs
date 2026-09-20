use std::sync::atomic::{AtomicBool, Ordering};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, WebviewWindow};

// One main window. Native WebView callbacks must not synchronously re-enter
// Tauri's window dispatcher: the runtime is holding its window store there.
static WANT_VISIBLE: AtomicBool = AtomicBool::new(true);

fn diagnostic_path(window: &WebviewWindow) -> Option<PathBuf> {
    crate::data_directory(window.app_handle()).ok().map(|p| p.join("ui-power.json"))
}
fn record(path: Option<&Path>, state: &str) {
    if let Some(path) = path {
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map(|v| v.as_secs()).unwrap_or(0);
        let _ = std::fs::write(path, serde_json::json!({"state":state,"at":at}).to_string());
    }
}
fn notify_visible(window: WebviewWindow) {
    // Dispatch after this native callback yields; never emit while the runtime
    // is borrowing the WebView. Cross-thread dispatch is queued by Tauri.
    std::thread::spawn(move || { let _ = window.emit("observer-visible", true); });
}

pub fn hide(window: &WebviewWindow) {
    WANT_VISIBLE.store(false, Ordering::SeqCst);
    if window.hide().is_err() { WANT_VISIBLE.store(true, Ordering::SeqCst); return; }
    #[cfg(windows)] {
        use webview2_com::{Microsoft::Web::WebView2::Win32::ICoreWebView2_3, TrySuspendCompletedHandler};
        use windows::core::Interface;
        let target = window.clone();
        let path = diagnostic_path(window);
        let fallback_path = path.clone();
        let result = window.with_webview(move |platform| unsafe {
            let suspend = || -> windows::core::Result<()> {
                if WANT_VISIBLE.load(Ordering::SeqCst) { return Ok(()); }
                let controller = platform.controller();
                controller.SetIsVisible(false)?;
                let core: ICoreWebView2_3 = controller.CoreWebView2()?.cast()?;
                let callback_window = target.clone();
                let callback_core = core.clone();
                let callback_path = path.clone();
                core.TrySuspend(&TrySuspendCompletedHandler::create(Box::new(move |result, suspended| {
                    if WANT_VISIBLE.load(Ordering::SeqCst) {
                        let _ = callback_core.Resume();
                        record(callback_path.as_deref(), "active");
                        notify_visible(callback_window.clone());
                    } else {
                        record(callback_path.as_deref(), if result.is_ok() && suspended { "suspended" } else { "hidden-suspend-unavailable" });
                    }
                    Ok(())
                })))
            };
            if suspend().is_err() { record(path.as_deref(), "hidden-suspend-unavailable"); }
        });
        if result.is_err() { record(fallback_path.as_deref(), "hidden-suspend-unavailable"); }
    }
}

pub fn show(window: &WebviewWindow) {
    WANT_VISIBLE.store(true, Ordering::SeqCst);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    #[cfg(windows)] {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use windows::core::Interface;
        let target = window.clone();
        let path = diagnostic_path(window);
        let _ = window.with_webview(move |platform| unsafe {
            if !WANT_VISIBLE.load(Ordering::SeqCst) { return; }
            let resume = || -> windows::core::Result<()> {
                let controller = platform.controller();
                let core: ICoreWebView2_3 = controller.CoreWebView2()?.cast()?;
                core.Resume()?;
                controller.SetIsVisible(true)?;
                Ok(())
            };
            record(path.as_deref(), if resume().is_ok() { "active" } else { "resume-unavailable" });
            notify_visible(target);
        });
    }
    #[cfg(not(windows))]
    notify_visible(window.clone());
}
