// 国际化字符串常量
// 用于统一管理前端所有中文硬编码字符串，便于后续 i18n 扩展

export const i18n = {
  // 视图标签
  view: {
    favorites: "收藏",
    history: "历史",
    all: "全部",
  },

  // 按钮标题
  action: {
    favorite: "收藏",
    unfavorite: "取消收藏",
    edit: "详情/编辑",
    delete: "删除",
    pasteAsPlainText: "粘贴为纯文本",
    showAll: "显示全部",
    viewFavorites: "查看收藏",
  },

  // 空状态文本
  empty: {
    noFavorites: "暂无收藏内容",
    noFavoritesHint: "点击卡片上的爱心图标收藏内容",
    noHistory: "暂无剪贴板内容",
    noHistoryHint: "复制内容后将显示在这里",
    noFavoritesMatch: "未找到匹配的收藏内容",
    noHistoryMatch: "没有找到匹配的内容",
  },

  // 提示消息
  toast: {
    addedToFavorites: "已添加到收藏",
    removedFromFavorites: "已取消收藏",
  },
};

// 快捷访问别名
export const t = i18n;