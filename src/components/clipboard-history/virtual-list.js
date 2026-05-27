// Virtual List Manager for clipboard history
// Handles virtual scrolling, dynamic height measurement, and infinite scroll

import {loadItemImage} from "./clipboard-item.js";

const BUFFER_SIZE = 5;
const BATCH_SIZE = 20;
const ESTIMATED_ITEM_HEIGHT = 120;
const THROTTLE_MS_60FPS = 16; // ~60fps scroll throttle

export class VirtualListManager {
  constructor(container, options = {}) {
    this.container = container;
    this.items = [];
    this.filteredItems = [];
    this.renderedStart = 0;
    this.renderedEnd = 0;
    this.scrollTop = 0;
    this.containerHeight = 0;
    this.itemHeights = new Map();
    this.totalHeight = 0;
    this.isLoading = false;
    this.hasMore = true;
    this.offset = 0;
    this._scrollHandler = null;

    this.onLoadMore = options.onLoadMore || (() => {});
    this.onRenderItem = options.onRenderItem || (() => "");

    this.init();
  }

  init() {
    this.scrollContainer = this.container;
    this.scrollContainer.style.overflow = "auto";
    this.scrollContainer.style.position = "relative";

    this.spacerTop = document.createElement("div");
    this.spacerTop.style.cssText = "width: 100%; height: 0px; flex-shrink: 0; will-change: height;";
    this.container.insertBefore(this.spacerTop, this.container.firstChild);

    this.sentinel = document.createElement("div");
    this.sentinel.id = "scroll-sentinel";
    this.sentinel.style.cssText = "height: 1px; width: 100%;";
    this.container.appendChild(this.sentinel);

    this.scrollObserver = new IntersectionObserver(
      (entries) => this.handleSentinelIntersection(entries),
      {root: this.scrollContainer, threshold: 0.1}
    );
    this.scrollObserver.observe(this.sentinel);

    this._scrollHandler = this.throttle(() => this.handleScroll(), THROTTLE_MS_60FPS);
    this.scrollContainer.addEventListener("scroll", this._scrollHandler);

    this.resizeObserver = new ResizeObserver(() => this.updateContainerHeight());
    this.resizeObserver.observe(this.scrollContainer);

    this.itemResizeObserver = new ResizeObserver((entries) =>
      this.handleItemResize(entries)
    );
  }

  handleScroll() {
    this.scrollTop = this.scrollContainer.scrollTop;
    this.updateVisibleRange();
  }

  updateContainerHeight() {
    this.containerHeight = this.scrollContainer.clientHeight;
    this.updateVisibleRange();
  }

  getItemTop(index) {
    let top = 0;
    for (let i = 0; i < index; i++) {
      top += this.itemHeights.get(i) || ESTIMATED_ITEM_HEIGHT;
    }
    return top;
  }

  getItemBottom(index) {
    return this.getItemTop(index) + (this.itemHeights.get(index) || ESTIMATED_ITEM_HEIGHT);
  }

  findStartIndexForScroll(scrollTop) {
    let accumulated = 0;
    for (let i = 0; i < this.filteredItems.length; i++) {
      accumulated += this.itemHeights.get(i) || ESTIMATED_ITEM_HEIGHT;
      if (accumulated >= scrollTop) {
        return i;
      }
    }
    return this.filteredItems.length - 1;
  }

  updateVisibleRange() {
    if (this.filteredItems.length === 0) return;

    const viewportTop = this.scrollTop;
    const viewportBottom = this.scrollTop + this.containerHeight;

    let startIndex = this.findStartIndexForScroll(viewportTop);
    let endIndex = startIndex;

    let accumulated = this.getItemTop(startIndex);
    while (accumulated < viewportBottom && endIndex < this.filteredItems.length) {
      accumulated += this.itemHeights.get(endIndex) || ESTIMATED_ITEM_HEIGHT;
      endIndex++;
    }

    startIndex = Math.max(0, startIndex - BUFFER_SIZE);
    endIndex = Math.min(this.filteredItems.length, endIndex + BUFFER_SIZE);

    if (
      startIndex !== this.renderedStart ||
      endIndex !== this.renderedEnd
    ) {
      this.renderedStart = startIndex;
      this.renderedEnd = endIndex;
      this.render();
    }
  }

  setItems(items) {
    this.items = items;
    this.filteredItems = items;
    this.offset = 0;
    this.hasMore = false;
    this.renderedStart = 0;
    this.renderedEnd = Math.min(items.length, BATCH_SIZE);
    this.itemHeights.clear();
    this.totalHeight = 0;
    this.render();
  }

  filterItems(filteredItems) {
    this.filteredItems = filteredItems;
    this.renderedStart = 0;
    this.renderedEnd = filteredItems.length;
    this.itemHeights.clear();
    this.totalHeight = 0;
    this.hasMore = false;
    this.render();
  }

  prependItem(item) {
    this.items.unshift(item);
    this.filteredItems.unshift(item);

    if (this.renderedStart === 0) {
      this.renderedEnd = Math.min(
        this.filteredItems.length,
        this.renderedEnd + 1
      );
      this.render();
    }
  }

  removeItem(id) {
    const index = this.items.findIndex(item => item.id === id);
    if (index === -1) {
      console.log(`[VirtualList] removeItem: item ${id} not found`);
      return false;
    }

    console.log(`[VirtualList] removeItem: index=${index}, items before=${this.items.length}`);
    this.items.splice(index, 1);
    this.filteredItems.splice(index, 1);

    // 删除高度缓存（后续索引会自动重新测量）
    this.itemHeights.delete(index);

    // 重新渲染（如果删除的项目在可视区域内）
    if (index >= this.renderedStart && index < this.renderedEnd) {
      this.renderedEnd = Math.min(this.filteredItems.length, this.renderedEnd);
      this.render();
    } else if (index < this.renderedStart) {
      // 删除的在可视区域之前，需要调整起始位置
      this.renderedStart = Math.max(0, this.renderedStart - 1);
      this.renderedEnd = Math.min(this.filteredItems.length, this.renderedEnd);
      this.render();
    }
    console.log(`[VirtualList] removeItem: items after=${this.items.length}`);
    return true;
  }

  async loadMore() {
    if (this.isLoading || !this.hasMore) return;

    this.isLoading = true;
    try {
      const result = await this.onLoadMore(this.offset);
      if (result && result.items) {
        this.items = [...this.items, ...result.items];
        this.filteredItems = [...this.filteredItems, ...result.items];
        this.offset += result.items.length;
        this.hasMore = result.has_more;
        this.renderedEnd = Math.min(
          this.filteredItems.length,
          this.renderedEnd + result.items.length
        );
        this.render();
      }
    } finally {
      this.isLoading = false;
    }
  }

  handleSentinelIntersection(entries) {
    // 暂时禁用无限滚动，因为数据是一次性加载的
    // if (entries[0].isIntersecting && !this.isLoading && this.hasMore) {
    //   this.loadMore();
    // }
  }

  handleItemResize(entries) {
    let needsRerender = false;
    for (const entry of entries) {
      const element = entry.target;
      const index = parseInt(element.dataset.index, 10);
      const newHeight = entry.contentRect.height;

      if (this.itemHeights.get(index) !== newHeight) {
        this.itemHeights.set(index, newHeight);
        needsRerender = true;
      }
    }
    if (needsRerender) {
      this.updateSpacerHeights();
    }
  }

  updateSpacerHeights() {
    if (this.spacerTop.parentNode) {
      this.spacerTop.style.height = `${this.getItemTop(this.renderedStart)}px`;
    }
  }

  render() {
    this.container.innerHTML = "";

    // 只有在需要时才添加 spacerTop（当不是从头开始渲染时）
    if (this.renderedStart > 0) {
      this.container.appendChild(this.spacerTop);
      this.spacerTop.style.height = `${this.getItemTop(this.renderedStart)}px`;
      console.log(`[VirtualList] spacerTop added: height=${this.getItemTop(this.renderedStart)}`);
    }

    console.log(`[VirtualList] render: items ${this.renderedStart}-${this.renderedEnd} of ${this.filteredItems.length}, containerH=${this.containerHeight}`);

    const fragment = document.createDocumentFragment();

    for (let i = this.renderedStart; i < this.renderedEnd; i++) {
      const item = this.filteredItems[i];
      if (!item) continue;

      const html = this.onRenderItem(item, i);
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      const element = wrapper.firstElementChild;
      element.dataset.index = i;
      fragment.appendChild(element);
    }

    this.container.appendChild(fragment);

    // 只有在还有更多项目时才添加 bottomSpacer
    if (this.renderedEnd < this.filteredItems.length) {
      const bottomSpacer = document.createElement("div");
      let remainingHeight = 0;
      for (let i = this.renderedEnd; i < this.filteredItems.length; i++) {
        remainingHeight += this.itemHeights.get(i) || ESTIMATED_ITEM_HEIGHT;
      }
      bottomSpacer.style.height = `${remainingHeight}px`;
      this.container.appendChild(bottomSpacer);
      console.log(`[VirtualList] bottomSpacer added: height=${remainingHeight}`);
      // sentinel 只在需要无限滚动时添加
      this.container.appendChild(this.sentinel);
    }

    this.itemResizeObserver.disconnect();
    const renderedItems = this.container.querySelectorAll("[data-index]");
    renderedItems.forEach((el) => {
      const index = parseInt(el.dataset.index, 10);
      if (!this.itemHeights.has(index)) {
        this.itemHeights.set(index, el.offsetHeight);
      }
      this.itemResizeObserver.observe(el);
    });

    this.setupImageLazyLoading();
  }

  setupImageLazyLoading() {
    const images = this.container.querySelectorAll(".preview-image.loading");

    const imageObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = entry.target;
            loadItemImage(img);
            observer.unobserve(img);
          }
        });
      },
      {root: this.scrollContainer, rootMargin: "100px"}
    );

    images.forEach((img) => imageObserver.observe(img));
  }

  throttle(func, limit) {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  destroy() {
    if (this._scrollHandler) {
      this.scrollContainer.removeEventListener("scroll", this._scrollHandler);
      this._scrollHandler = null;
    }
    this.scrollObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.itemResizeObserver?.disconnect();
  }
}