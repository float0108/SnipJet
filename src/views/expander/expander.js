// 文本扩展规则管理
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { log, error } from "../../utils/logger.js";

// 规则列表
let rules = [];

/**
 * 初始化
 */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[expander] 初始化文本扩展管理器");

  // 绑定关闭按钮
  const closeBtn = document.getElementById("close-button");
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
      }
    ];

    renderRules();
    console.log("[expander] 加载了", rules.length, "条规则");
  } catch (err) {
    console.error("[expander] 加载规则失败:", err);
    await error("加载规则失败:", err);
  }
}

/**
 * 渲染规则列表
 */
function renderRules() {
  const container = document.getElementById("rules-list");
  if (!container) return;

  if (rules.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📝</div>
        <div>暂无文本扩展规则</div>
        <div style="font-size: 12px; margin-top: 8px;">点击"添加规则"创建新规则</div>
      </div>
    `;
    return;
  }

  container.innerHTML = rules.map((rule, index) => `
    <div class="rule-item" data-index="${index}">
      <input
        type="text"
        class="rule-input key-input"
        placeholder="触发词，如 :te"
        value="${escapeHtml(rule.key)}"
        data-field="key"
        data-index="${index}"
      />
      <input
        type="text"
        class="rule-input"
        placeholder="扩展内容"
        value="${escapeHtml(rule.content)}"
        data-field="content"
        data-index="${index}"
      />
      <input
        type="text"
        class="rule-input"
        placeholder="分组"
        value="${escapeHtml(rule.group || '')}"
        data-field="group"
        data-index="${index}"
        style="width: 100px;"
      />
      <button class="delete-btn" data-index="${index}">删除</button>
    </div>
  `).join('');

  // 绑定输入事件
  container.querySelectorAll('.rule-input').forEach(input => {
    input.addEventListener('input', handleInputChange);
  });

  // 绑定删除按钮
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDelete);
  });
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
    console.log(`[expander] 规则 ${index} 的 ${field} 更新为:`, value);
  }
}

/**
 * 处理删除
 */
function handleDelete(e) {
  const index = parseInt(e.target.dataset.index);
  if (confirm('确定要删除这条规则吗？')) {
    rules.splice(index, 1);
    renderRules();
    console.log("[expander] 删除规则", index);
  }
}

/**
 * 添加新规则
 */
function addRule() {
  rules.push({
    key: "",
    content: "",
    group: "default",
    description: ""
  });
  renderRules();

  // 聚焦到新规则的触发词输入框
  const inputs = document.querySelectorAll('.rule-input.key-input');
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }

  console.log("[expander] 添加新规则");
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
    // 注意：这里需要通过 Tauri 命令保存文件
    // 暂时使用下载方式
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
