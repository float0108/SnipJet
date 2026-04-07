// 文本扩展规则管理
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { log, error } from "../../utils/logger.js";

// 规则列表
let rules = [];
let originalRules = [];
let currentGroup = "";
let searchQuery = "";
let allGroups = [];

// 当前激活的分组输入
let activeGroupInput = null;
let suggestionsEl = null;

// ========== 提示气泡系统 ==========
function showToast(message, type = 'info') {
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${icons[type]}<span>${message}</span>`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

// ========== 确认对话框系统 ==========
function showConfirm(title, message) {
  return new Promise((resolve) => {
    const existingDialog = document.querySelector('.dialog-overlay');
    if (existingDialog) existingDialog.remove();

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-box">
        <div class="dialog-title">${title}</div>
        <div class="dialog-message">${message}</div>
        <div class="dialog-buttons">
          <button class="dialog-btn dialog-btn-cancel">取消</button>
          <button class="dialog-btn dialog-btn-confirm">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('show'));

    const close = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    overlay.querySelector('.dialog-btn-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.dialog-btn-confirm').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

    const escHandler = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        close(false);
      }
    };
    document.addEventListener('keydown', escHandler);
  });
}

// ========== 分组输入建议系统 ==========
function createSuggestionsElement() {
  if (!suggestionsEl) {
    suggestionsEl = document.createElement('div');
    suggestionsEl.className = 'group-suggestions';
    document.body.appendChild(suggestionsEl);
  }
  return suggestionsEl;
}

function showSuggestions(inputEl, searchText) {
  const suggestions = createSuggestionsElement();
  const search = searchText.toLowerCase().trim();

  // 过滤匹配的分组
  const matches = allGroups.filter(g => !search || g.toLowerCase().includes(search));
  const isNewGroup = search && !allGroups.some(g => g.toLowerCase() === search);

  // 构建建议列表
  let html = '';
  matches.forEach(g => {
    html += `<div class="group-suggestion-item" data-group="${escapeHtml(g)}">${escapeHtml(g)}</div>`;
  });
  if (isNewGroup) {
    html += `<div class="group-suggestion-item group-suggestion-create" data-group="${escapeHtml(search)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      <span>创建 "${escapeHtml(search)}"</span>
    </div>`;
  }

  if (html) {
    suggestions.innerHTML = html;
    // 定位到输入框下方
    const rect = inputEl.getBoundingClientRect();
    suggestions.style.left = `${rect.left}px`;
    suggestions.style.top = `${rect.bottom + 4}px`;
    suggestions.classList.add('show');
  } else {
    hideSuggestions();
  }
}

function hideSuggestions() {
  if (suggestionsEl) {
    suggestionsEl.classList.remove('show');
  }
}

function selectSuggestion(group) {
  if (activeGroupInput) {
    const index = parseInt(activeGroupInput.dataset.index);
    if (rules[index]) {
      rules[index].group = group;
      // 如果是新分组，更新列表
      if (!allGroups.includes(group)) {
        allGroups.push(group);
        updateGroupFilter();
      }
      // 恢复显示态
      renderRules();
    }
  }
  hideSuggestions();
  activeGroupInput = null;
}

/**
 * 初始化
 */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[expander] 初始化文本扩展管理器");

  // 点击其他地方关闭建议
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.group-tag-input') && !e.target.closest('.group-suggestions')) {
      hideSuggestions();
      // 如果有激活的输入框，恢复显示态
      if (activeGroupInput) {
        renderRules();
        activeGroupInput = null;
      }
    }
  });

  // 建议列表点击事件
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.group-suggestion-item');
    if (item) {
      selectSuggestion(item.dataset.group);
    }
  });

  document.getElementById("add-rule-btn")?.addEventListener("click", () => addRule());
  document.getElementById("close-btn")?.addEventListener("click", closeWindow);
  document.getElementById("save-rules-btn")?.addEventListener("click", saveRules);
  document.getElementById("cancel-btn")?.addEventListener("click", cancelChanges);

  document.getElementById("group-filter")?.addEventListener("change", (e) => {
    currentGroup = e.target.value;
    renderRules();
  });

  const helpBtn = document.getElementById("help-btn");
  const helpDropdown = document.getElementById("help-dropdown");
  if (helpBtn && helpDropdown) {
    helpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      helpDropdown.classList.toggle("show");
    });
    document.addEventListener("click", () => helpDropdown.classList.remove("show"));
    helpDropdown.addEventListener("click", (e) => e.stopPropagation());
  }

  const searchBtn = document.getElementById("search-btn");
  const searchBox = document.getElementById("search-box");
  const searchInput = document.getElementById("search-input");
  const searchClose = document.getElementById("search-close");

  if (searchBtn && searchBox && searchInput) {
    searchBtn.addEventListener("click", () => {
      searchBox.classList.add("active");
      searchInput.focus();
    });

    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderRules();
    });

    const closeSearch = () => {
      searchBox.classList.remove("active");
      searchInput.value = "";
      searchQuery = "";
      renderRules();
    };

    searchClose?.addEventListener("click", closeSearch);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSearch();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveRules();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      searchBox?.classList.add("active");
      searchInput?.focus();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelChanges();
    }
  });

  await loadRules();
});

async function closeWindow() {
  try {
    await getCurrentWebviewWindow().close();
  } catch (err) {
    window.close();
  }
}

async function loadRules() {
  try {
    const loadedRules = await invoke('load_text_expand_rules');
    rules = loadedRules?.length > 0 ? loadedRules : getDefaultRules();
    originalRules = JSON.parse(JSON.stringify(rules));
    updateAllGroups();
    updateGroupFilter();
    renderRules();
    console.log("[expander] 加载了", rules.length, "条规则");
  } catch (err) {
    console.error("[expander] 加载规则失败:", err);
    rules = getDefaultRules();
    originalRules = JSON.parse(JSON.stringify(rules));
    updateAllGroups();
    updateGroupFilter();
    renderRules();
  }
}

function getDefaultRules() {
  return [
    { key: ":te", content: "textexpand", group: "default", description: "示例扩展规则", date: new Date().toISOString().split('T')[0] },
    { key: ":date", content: new Date().toLocaleDateString(), group: "常用", description: "当前日期", date: new Date().toISOString().split('T')[0] },
    { key: ":time", content: new Date().toLocaleTimeString(), group: "常用", description: "当前时间", date: new Date().toISOString().split('T')[0] },
    { key: ":mail", content: "example@email.com", group: "个人信息", description: "邮箱地址", date: new Date().toISOString().split('T')[0] },
    { key: ":addr", content: "北京市朝阳区xxx街道", group: "个人信息", description: "地址", date: new Date().toISOString().split('T')[0] }
  ];
}

function updateAllGroups() {
  allGroups = [...new Set(rules.map(r => r.group || "default"))];
}

function updateGroupFilter() {
  const filterSelect = document.getElementById("group-filter");
  if (!filterSelect) return;

  const currentValue = filterSelect.value;
  filterSelect.innerHTML = `<option value="">全部分组 (${rules.length})</option>`;
  allGroups.forEach(group => {
    const count = rules.filter(r => (r.group || "default") === group).length;
    const option = document.createElement("option");
    option.value = group;
    option.textContent = `${group} (${count})`;
    filterSelect.appendChild(option);
  });
  if (allGroups.includes(currentGroup)) filterSelect.value = currentGroup;
}

function renderRules() {
  const container = document.getElementById("rules-list");
  if (!container) return;

  let filteredRules = rules;
  if (currentGroup) filteredRules = filteredRules.filter(r => (r.group || "default") === currentGroup);
  if (searchQuery) {
    filteredRules = filteredRules.filter(r =>
      r.key.toLowerCase().includes(searchQuery) ||
      r.content.toLowerCase().includes(searchQuery) ||
      (r.description || "").toLowerCase().includes(searchQuery) ||
      (r.group || "default").toLowerCase().includes(searchQuery)
    );
  }

  if (filteredRules.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <div class="empty-text">${searchQuery ? "未找到匹配的规则" : (currentGroup ? "该分组暂无规则" : "暂无文本扩展规则")}</div>
        <div class="empty-hint">${searchQuery ? "尝试其他搜索关键词" : "点击工具栏的 + 按钮创建新规则"}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredRules.map((rule) => {
    const originalIndex = rules.indexOf(rule);
    const currentGroupValue = rule.group || "default";

    return `
    <div class="rule-item" data-index="${originalIndex}">
      <button class="delete-btn" data-index="${originalIndex}" title="删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
      </button>
      <div class="rule-trigger">
        <input type="text" class="rule-trigger-input" placeholder=":te" value="${escapeHtml(rule.key)}" data-field="key" data-index="${originalIndex}" />
      </div>
      <span class="rule-arrow">→</span>
      <div class="rule-content-wrapper">
        <input type="text" class="rule-content-input" placeholder="扩展内容..." value="${escapeHtml(rule.content)}" data-field="content" data-index="${originalIndex}" />
      </div>
      <div class="rule-group-tag">
        <span class="group-tag-display" data-index="${originalIndex}">${escapeHtml(currentGroupValue)}</span>
      </div>
    </div>
  `}).join('');

  bindRuleEvents();
}

function bindRuleEvents() {
  const container = document.getElementById("rules-list");

  container.querySelectorAll('.rule-trigger-input, .rule-content-input').forEach(input => {
    input.addEventListener('input', handleInputChange);
  });

  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDelete);
  });

  // 分组标签点击 -> 变成输入框
  container.querySelectorAll('.group-tag-display').forEach(tag => {
    tag.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(tag.dataset.index);
      const currentGroupValue = rules[index]?.group || "default";

      // 替换为输入框
      const parent = tag.parentElement;
      parent.innerHTML = `<input type="text" class="group-tag-input" data-index="${index}" placeholder="分组名..." value="" />`;
      const input = parent.querySelector('.group-tag-input');
      input.focus();

      activeGroupInput = input;

      // 输入事件 - 显示建议
      input.addEventListener('input', (ie) => {
        showSuggestions(input, ie.target.value);
      });

      // 失焦事件
      input.addEventListener('blur', () => {
        // 延迟处理，让点击建议有机会执行
        setTimeout(() => {
          if (activeGroupInput === input) {
            const value = input.value.trim();
            if (value) {
              selectSuggestion(value);
            } else {
              renderRules();
            }
          }
        }, 150);
      });

      // 键盘事件
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') {
          ke.preventDefault();
          const value = input.value.trim();
          if (value) {
            selectSuggestion(value);
          } else {
            renderRules();
          }
        }
        if (ke.key === 'Escape') {
          ke.stopPropagation();
          renderRules();
          activeGroupInput = null;
        }
      });

      // 显示所有分组建议
      showSuggestions(input, '');
    });
  });
}

function handleInputChange(e) {
  const index = parseInt(e.target.dataset.index);
  const field = e.target.dataset.field;
  if (rules[index]) rules[index][field] = e.target.value;
}

async function handleDelete(e) {
  const index = parseInt(e.currentTarget.dataset.index);
  if (await showConfirm('删除规则', '确定要删除这条规则吗？')) {
    rules.splice(index, 1);
    updateAllGroups();
    updateGroupFilter();
    renderRules();
    showToast('规则已删除', 'success');
  }
}

function addRule() {
  rules.push({
    key: "", content: "", group: currentGroup || "default", description: "", date: new Date().toISOString().split('T')[0]
  });
  updateAllGroups();
  updateGroupFilter();
  renderRules();
  setTimeout(() => {
    const inputs = document.querySelectorAll('.rule-trigger-input');
    inputs[inputs.length - 1]?.focus();
  }, 10);
}

async function saveRules() {
  const validRules = rules.filter(r => r.key.trim() && r.content.trim());

  if (validRules.length !== rules.length) {
    showToast('触发词和扩展内容不能为空', 'warning');
    return;
  }

  const keys = validRules.map(r => r.key);
  const duplicates = keys.filter((item, idx) => keys.indexOf(item) !== idx);
  if (duplicates.length > 0) {
    showToast(`发现重复的触发词: ${duplicates.join(', ')}`, 'error');
    return;
  }

  try {
    await invoke('save_text_expand_rules', { rules: validRules });
    await invoke('reload_text_expand_rules');
    originalRules = JSON.parse(JSON.stringify(rules));
    showToast('规则保存成功', 'success');
  } catch (err) {
    console.error("[expander] 保存规则失败:", err);
    showToast('保存失败: ' + err, 'error');
  }
}

async function cancelChanges() {
  const hasChanges = JSON.stringify(rules) !== JSON.stringify(originalRules);
  if (hasChanges && !await showConfirm('放弃更改', '有未保存的更改，确定要放弃吗？')) return;

  rules = JSON.parse(JSON.stringify(originalRules));
  updateAllGroups();
  currentGroup = "";
  searchQuery = "";
  updateGroupFilter();
  renderRules();
  if (!hasChanges) closeWindow();
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.closeWindow = closeWindow;
window.addRule = addRule;
window.saveRules = saveRules;
window.cancelChanges = cancelChanges;
