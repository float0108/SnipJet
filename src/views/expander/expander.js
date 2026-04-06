// 文本扩展规则管理
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { log, error } from "../../utils/logger.js";

// 规则列表
let rules = [];
// 当前筛选的分组
let currentGroup = "";

/**
 * 初始化
 */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[expander] 初始化文本扩展管理器");

  // 绑定关闭按钮
  const closeBtn = document.getElementById("close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeWindow);
  }

  // 绑定添加规则按钮
  const addBtn = document.getElementById("add-rule-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => addRule());
  }

  // 绑定保存按钮
  const saveBtn = document.getElementById("save-rules-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", saveRules);
  }

  // 绑定分组筛选
  const groupFilter = document.getElementById("group-filter");
  if (groupFilter) {
    groupFilter.addEventListener("change", (e) => {
      currentGroup = e.target.value;
      renderRules();
    });
  }

  // 绑定帮助按钮
  const helpBtn = document.getElementById("help-btn");
  const helpDropdown = document.getElementById("help-dropdown");
  if (helpBtn && helpDropdown) {
    helpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      helpDropdown.classList.toggle("show");
    });

    // 点击其他地方关闭
    document.addEventListener("click", () => {
      helpDropdown.classList.remove("show");
    });

    helpDropdown.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  // 加载现有规则
  await loadRules();
});

/**
 * 关闭窗口
 */
async function closeWindow() {
  try {
    const win = getCurrentWebviewWindow();
    await win.close();
  } catch (err) {
    console.error("[expander] 关闭窗口失败:", err);
    window.close();
  }
}

/**
 * 加载规则
 */
async function loadRules() {
  try {
    // 尝试从文件加载规则
    // 由于 Rust 后端目前没有提供获取规则的命令，我们使用默认值
    rules = [
      {
        key: ":te",
        content: "textexpand",
        group: "default",
        description: "示例扩展规则"
      },
      {
        key: ":date",
        content: new Date().toLocaleDateString(),
        group: "常用",
        description: "当前日期"
      },
      {
        key: ":time",
        content: new Date().toLocaleTimeString(),
        group: "常用",
        description: "当前时间"
      },
      {
        key: ":mail",
        content: "example@email.com",
        group: "个人信息",
        description: "邮箱地址"
      },
      {
        key: ":addr",
        content: "北京市朝阳区xxx街道",
        group: "个人信息",
        description: "地址"
      }
    ];

    updateGroupFilter();
    renderRules();
    console.log("[expander] 加载了", rules.length, "条规则");
  } catch (err) {
    console.error("[expander] 加载规则失败:", err);
    await error("加载规则失败:", err);
  }
}

/**
 * 更新分组筛选器
 */
function updateGroupFilter() {
  const filterSelect = document.getElementById("group-filter");
  if (!filterSelect) return;

  // 获取所有分组
  const groups = [...new Set(rules.map(r => r.group || "default"))];

  // 保存当前选中值
  const currentValue = filterSelect.value;

  // 更新选项
  filterSelect.innerHTML = `<option value="">全部分组 (${rules.length})</option>`;
  groups.forEach(group => {
    const count = rules.filter(r => (r.group || "default") === group).length;
    const option = document.createElement("option");
    option.value = group;
    option.textContent = `${group} (${count})`;
    filterSelect.appendChild(option);
  });

  // 恢复选中值
  if (groups.includes(currentGroup)) {
    filterSelect.value = currentGroup;
  }
}

/**
 * 渲染规则列表
 */
function renderRules() {
  const container = document.getElementById("rules-list");
  if (!container) return;

  // 筛选规则
  const filteredRules = currentGroup
    ? rules.filter(r => (r.group || "default") === currentGroup)
    : rules;

  // 更新计数
  updateRuleCount(filteredRules.length, rules.length);

  if (filteredRules.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <div class="empty-text">${currentGroup ? "该分组暂无规则" : "暂无文本扩展规则"}</div>
        <div class="empty-hint">点击工具栏的 + 按钮创建新规则</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredRules.map((rule) => {
    const originalIndex = rules.indexOf(rule);
    return `
    <div class="rule-item" data-index="${originalIndex}">
      <div class="rule-trigger">
        <input
          type="text"
          class="rule-trigger-input"
          placeholder=":te"
          value="${escapeHtml(rule.key)}"
          data-field="key"
          data-index="${originalIndex}"
        />
      </div>
      <span class="rule-arrow">→</span>
      <div class="rule-content-wrapper">
        <input
          type="text"
          class="rule-content-input"
          placeholder="扩展内容..."
          value="${escapeHtml(rule.content)}"
          data-field="content"
          data-index="${originalIndex}"
        />
      </div>
      <div class="rule-group-tag">
        <span class="group-label" data-index="${originalIndex}" title="点击编辑分组">${escapeHtml(rule.group || "default")}</span>
      </div>
      <button class="delete-btn" data-index="${originalIndex}" title="删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    </div>
  `}).join('');

  // 绑定事件
  bindRuleEvents();
}

/**
 * 绑定规则事件
 */
function bindRuleEvents() {
  const container = document.getElementById("rules-list");

  // 输入事件
  container.querySelectorAll('.rule-trigger-input, .rule-content-input').forEach(input => {
    input.addEventListener('input', handleInputChange);
  });

  // 分组标签点击编辑
  container.querySelectorAll('.group-label').forEach(label => {
    label.addEventListener('click', handleGroupClick);
  });

  // 删除按钮
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDelete);
  });
}

/**
 * 更新规则计数
 */
function updateRuleCount(filtered, total) {
  const countEl = document.getElementById("rule-count");
  if (countEl) {
    if (currentGroup) {
      countEl.textContent = `${filtered}/${total} 条规则`;
    } else {
      countEl.textContent = `${total} 条规则`;
    }
  }
}

/**
 * 处理输入变化
 */
function handleInputChange(e) {
  const index = parseInt(e.target.dataset.index);
  const field = e.target.dataset.field;
  const value = e.target.value;

  if (rules[index]) {
    rules[index][field] = value;
  }
}

/**
 * 处理分组点击 - 转为编辑模式
 */
function handleGroupClick(e) {
  const index = parseInt(e.target.dataset.index);
  const rule = rules[index];
  if (!rule) return;

  const container = e.target.parentElement;
  const currentValue = rule.group || "default";

  // 替换为输入框
  container.innerHTML = `
    <input
      type="text"
      class="group-input"
      placeholder="分组名"
      value="${escapeHtml(currentValue)}"
      data-field="group"
      data-index="${index}"
    />
  `;

  const input = container.querySelector('.group-input');
  input.focus();
  input.select();

  // 保存并恢复
  const saveAndRestore = () => {
    const newValue = input.value.trim() || "default";
    rules[index].group = newValue;
    updateGroupFilter();
    renderRules();
  };

  input.addEventListener('blur', saveAndRestore);
  input.addEventListener('keydown', (ke) => {
    if (ke.key === 'Enter') {
      ke.preventDefault();
      saveAndRestore();
    }
  });
}

/**
 * 处理删除
 */
function handleDelete(e) {
  const index = parseInt(e.currentTarget.dataset.index);
  if (confirm('确定要删除这条规则吗？')) {
    rules.splice(index, 1);
    updateGroupFilter();
    renderRules();
  }
}

/**
 * 添加新规则
 */
function addRule() {
  const newGroup = currentGroup || "default";
  rules.push({
    key: "",
    content: "",
    group: newGroup,
    description: ""
  });
  updateGroupFilter();
  renderRules();

  // 聚焦到新规则的触发词输入框
  setTimeout(() => {
    const inputs = document.querySelectorAll('.rule-trigger-input');
    if (inputs.length > 0) {
      inputs[inputs.length - 1].focus();
    }
  }, 10);
}

/**
 * 保存规则
 */
async function saveRules() {
  try {
    // 验证规则
    const validRules = rules.filter(r => r.key.trim() && r.content.trim());

    if (validRules.length !== rules.length) {
      alert('触发词和扩展内容不能为空，请检查规则');
      return;
    }

    // 检查重复触发词
    const keys = validRules.map(r => r.key);
    const duplicates = keys.filter((item, index) => keys.indexOf(item) !== index);
    if (duplicates.length > 0) {
      alert(`发现重复的触发词: ${duplicates.join(', ')}`);
      return;
    }

    // 生成 YAML 内容
    const yamlContent = generateYaml(validRules);

    // 保存到文件
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'text_expand.yaml';
    a.click();
    URL.revokeObjectURL(url);

    console.log("[expander] 规则已保存", validRules.length, "条");
    alert('规则已导出为 text_expand.yaml，请将其放到软件配置目录');

    await log("文本扩展规则已保存");
  } catch (err) {
    console.error("[expander] 保存规则失败:", err);
    await error("保存规则失败:", err);
    alert('保存失败: ' + err.message);
  }
}

/**
 * 生成 YAML 内容
 */
function generateYaml(rules) {
  const lines = ['rules:'];

  for (const rule of rules) {
    lines.push('  - key: ' + JSON.stringify(rule.key));
    lines.push('    content: ' + JSON.stringify(rule.content));
    lines.push('    group: ' + JSON.stringify(rule.group || 'default'));
    lines.push('    description: ' + JSON.stringify(rule.description || ''));
    lines.push('    date: ' + JSON.stringify(new Date().toISOString().split('T')[0]));
  }

  return lines.join('\n');
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 暴露到全局
window.closeWindow = closeWindow;
window.addRule = addRule;
window.saveRules = saveRules;
