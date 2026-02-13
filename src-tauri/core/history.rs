use anyhow::Result;
use windows::core::*;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::{UpdateWindow, COLOR_WINDOW, HBRUSH};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::clipboard::ClipboardMonitor;

const WM_UPDATE_TEXT: u32 = WM_USER + 1;

static mut H_DISPLAY_TEXT: HWND = HWND(0);
static mut PENDING_TEXT: String = String::new();

pub fn create_window() -> Result<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None)?;
        let class_name = w!("ClipboardMonitorClass");

        let wnd_class = WNDCLASSW {
            lpfnWndProc: Some(wnd_proc),
            hInstance: instance.into(),
            lpszClassName: class_name,
            hbrBackground: HBRUSH((COLOR_WINDOW.0 + 1) as isize),
            ..Default::default()
        };

        RegisterClassW(&wnd_class);

        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            w!("剪贴板监控器"),
            WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            600,
            400,
            None,
            None,
            instance,
            None,
        );

        if hwnd.0 == 0 {
            return Err(anyhow::anyhow!("创建窗口失败"));
        }

        ShowWindow(hwnd, SW_SHOW);
        UpdateWindow(hwnd);

        Ok(hwnd)
    }
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CREATE => {
            let h_display_text = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!("等待剪贴板变化..."),
                WS_CHILD | WS_VISIBLE,
                20,
                20,
                540,
                300,
                hwnd,
                None,
                GetModuleHandleW(None).unwrap(),
                None,
            );
            H_DISPLAY_TEXT = h_display_text;
            LRESULT(0)
        }
        WM_UPDATE_TEXT => {
            let h_str = HSTRING::from(&PENDING_TEXT);
            SetWindowTextW(H_DISPLAY_TEXT, &h_str).ok();
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

pub fn update_display(item: &crate::clipboard::ClipboardItem) {
    unsafe {
        PENDING_TEXT = format!(
            "[{}] Hash: {}\n\n内容: {}...",
            item.timestamp, item.hash, item.preview
        );
    }
}
