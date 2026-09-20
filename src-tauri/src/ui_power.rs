use tauri::{Emitter, Manager, WebviewWindow};

fn record(window: &WebviewWindow, state: &str) {
    // A single bounded, local diagnostic record; no task data or append-only log.
    if let Ok(directory) = crate::data_directory(window.app_handle()) {
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map(|v| v.as_secs()).unwrap_or(0);
        let value = serde_json::json!({"state": state, "at": at});
        let _ = std::fs::write(directory.join("ui-power.json"), value.to_string());
    }
}

pub fn hide(window: &WebviewWindow) {
    if window.hide().is_err() { return; }
    #[cfg(windows)] {
        use webview2_com::{Microsoft::Web::WebView2::Win32::ICoreWebView2_3, TrySuspendCompletedHandler};
        use windows::core::Interface;
        let target = window.clone();
        let result = window.with_webview(move |platform| unsafe {
            let suspend = || -> windows::core::Result<()> {
                // Run on the WebView UI thread; hiding precedes suspension.
                if target.is_visible().unwrap_or(true) { return Ok(()); }
                let controller = platform.controller();
                controller.SetIsVisible(false)?;
                let core: ICoreWebView2_3 = controller.CoreWebView2()?.cast()?;
                let callback_window = target.clone();
                let callback_core = core.clone();
                core.TrySuspend(&TrySuspendCompletedHandler::create(Box::new(move |result, suspended| {
                    // Opening while TrySuspend is pending must never leave a visible page asleep.
                    if callback_window.is_visible().unwrap_or(false) {
                        let _ = callback_core.Resume();
                        let _ = callback_window.emit("observer-visible", true);
                        record(&callback_window, "active");
                    } else {
                        record(&callback_window, if result.is_ok() && suspended { "suspended" } else { "hidden-suspend-unavailable" });
                    }
                    Ok(())
                })))
            };
            if suspend().is_err() { record(&target, "hidden-suspend-unavailable"); }
        });
        if result.is_err() { record(window, "hidden-suspend-unavailable"); }
    }
}

pub fn show(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    #[cfg(windows)] {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use windows::core::Interface;
        let target = window.clone();
        let _ = window.with_webview(move |platform| unsafe {
            let resume = || -> windows::core::Result<()> {
                let controller = platform.controller();
                let core: ICoreWebView2_3 = controller.CoreWebView2()?.cast()?;
                core.Resume()?;
                controller.SetIsVisible(true)?;
                Ok(())
            };
            record(&target, if resume().is_ok() { "active" } else { "resume-unavailable" });
            let _ = target.emit("observer-visible", true);
        });
    }
    #[cfg(not(windows))]
    let _ = window.emit("observer-visible", true);
}
