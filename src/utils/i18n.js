// 国际化（i18n）模块
// 支持中文/英文切换，所有前端中文字符串统一管理

const translations = {
  cn: {
    view: {
      favorites: "收藏",
      history: "历史",
      all: "全部",
    },
    action: {
      favorite: "收藏",
      unfavorite: "取消收藏",
      edit: "详情/编辑",
      delete: "删除",
      pasteAsPlainText: "粘贴为纯文本",
      showAll: "显示全部",
      viewFavorites: "查看收藏",
    },
    empty: {
      noFavorites: "暂无收藏内容",
      noFavoritesHint: "点击卡片上的爱心图标收藏内容",
      noHistory: "暂无剪贴板内容",
      noHistoryHint: "复制内容后将显示在这里",
      noFavoritesMatch: "未找到匹配的收藏内容",
      noHistoryMatch: "没有找到匹配的内容",
    },
    toast: {
      addedToFavorites: "已添加到收藏",
      removedFromFavorites: "已取消收藏",
    },
  },
  en: {
    view: {
      favorites: "Favorites",
      history: "History",
      all: "All",
    },
    action: {
      favorite: "Favorite",
      unfavorite: "Unfavorite",
      edit: "Details / Edit",
      delete: "Delete",
      pasteAsPlainText: "Paste as Plain Text",
      showAll: "Show All",
      viewFavorites: "View Favorites",
    },
    empty: {
      noFavorites: "No favorites yet",
      noFavoritesHint: "Click the heart icon on a card to add favorites",
      noHistory: "No clipboard history",
      noHistoryHint: "Copied content will appear here",
      noFavoritesMatch: "No matching favorites found",
      noHistoryMatch: "No matching content found",
    },
    toast: {
      addedToFavorites: "Added to favorites",
      removedFromFavorites: "Removed from favorites",
    },
  },
};

// 当前语言设置
let _currentLocale = "cn";

// 获取当前翻译
function getTranslations() {
  return translations[_currentLocale] || translations.cn;
}

// 获取翻译后的字符串
export function t(key) {
  const trans = getTranslations();
  const keys = key.split(".");
  let value = trans;
  for (const k of keys) {
    value = value?.[k];
  }
  return value ?? key;
}

// 获取当前语言设置
export function getLocale() {
  return _currentLocale;
}

// 设置语言
export function setLocale(locale) {
  if (translations[locale]) {
    _currentLocale = locale;
  }
}

// 从 localStorage 加载语言设置
export function loadLocaleFromSettings() {
  try {
    const saved = localStorage.getItem("snipjet-settings");
    if (saved) {
      const settings = JSON.parse(saved);
      const lang = settings?.interface?.language;
      if (lang && translations[lang]) {
        _currentLocale = lang;
      }
    }
  } catch (e) {
    // ignore
  }
}

// 快捷访问别名
export { t as i18n };