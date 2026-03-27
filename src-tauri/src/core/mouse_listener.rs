use crate::common::globals::WINDOW_PIN_STATE; // 只需要 Pin 状态
use log::info;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

// 引入 Windows API
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::POINT;
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

// 定义鼠标左键的虚拟键码
const VK_LBUTTON: u16 = 0x01;
// 定义鼠标右键 (可选)
const VK_RBUTTON: u16 = 0x02;

// 保持 is_point_in_window 不变
pub fn is_point_in_window(window: &tauri::WebviewWindow, x: f64, y: f64) -> bool {
    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
        let x_min = pos.x as f64;
        let y_min = pos.y as f64;
        let x_max = x_min + size.width as f64;
        let y_max = y_min + size.height as f64;
        x >= x_min && x <= x_max && y >= y_min && y <= y_max
    } else {
        false
    }
}

pub fn start_global_click_listener(app: AppHandle) {
    info!("Starting global polling listener (Replacing rdev)...");

    thread::spawn(move || {
        info!("Global polling listener started");

        // 记录上一次鼠标状态，防止按住不放时重复触发
        let mut was_down = false;

        loop {
            // 1. 设置轮询间隔 (50ms - 100ms 足够灵敏且不耗电)
            thread::sleep(Duration::from_millis(50));

            // 2. 检查 App 状态 (如果窗口根本没开，就别浪费 CPU 计算)
            let window = match app.get_webview_window("main") {
                Some(w) => w,
                None => continue,
            };

            // 如果窗口不可见，直接跳过本次循环
            if !window.is_visible().unwrap_or(false) {
                // 如果窗口不可见，重置按键状态，防止下次显示时误判
                was_down = false;
                continue;
            }

            // 3. 检查 Pin 状态
            let is_pinned = if let Ok(lock) = WINDOW_PIN_STATE.lock() {
                *lock
            } else {
                false
            };
            if is_pinned {
                continue;
            }

            // 4. 获取鼠标左键状态 (Windows API)
            #[cfg(target_os = "windows")]
            let is_down = unsafe {
                // GetAsyncKeyState 返回值的最高位为1表示当前被按下
                (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0
            };

            // 非 Windows 平台的空实现 (防止编译报错)
            #[cfg(not(target_os = "windows"))]
            let is_down = false;

            // 5. 状态机逻辑：只在 "按下瞬间" 或 "按住期间" 触发
            // 这里我们选择：只要检测到按下，且不在窗口内，就隐藏
            if is_down {
                if !was_down {
                    // 这是按下的第一帧 (OnMouseDown)
                    // 获取鼠标位置
                    #[cfg(target_os = "windows")]
                    let (mx, my) = unsafe {
                        let mut point = POINT::default();
                        let _ = GetCursorPos(&mut point);
                        (point.x as f64, point.y as f64)
                    };

                    #[cfg(not(target_os = "windows"))]
                    let (mx, my) = (0.0, 0.0);

                    // 判断是否在外部
                    if !is_point_in_window(&window, mx, my) {
                        info!(
                            "Polling: Click outside detected at ({}, {}) -> Hiding",
                            mx, my
                        );

                        // 必须在主线程执行 UI 更新
                        let _ = window.hide();

                        // 可选：如果点击外部需要拦截点击事件不让下面的程序接收到，这是做不到的。
                        // 但通常仅仅隐藏窗口是足够的。
                    } else {
                        // debug!("Polling: Click inside window, ignoring.");
                    }
                }
                was_down = true;
            } else {
                was_down = false;
            }
        }
    });
}
