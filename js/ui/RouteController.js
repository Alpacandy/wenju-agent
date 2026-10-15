/** RouteController: browser UI responsibility with injected application dependencies. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.RouteController = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRouteController({ window, document, allPages, navTabs, globalNavbar, bcCurrentPage, studioQuickActions, moduleTitles, landingVisualizer }) {
  let currentModule = 'landing';
  const routerHistory = [];

  function navigate(targetModule, options = {}) {
    if (!Object.prototype.hasOwnProperty.call(allPages, targetModule)) return false;
    const isBack = options.isBack || false;

    // 1. 路由历史栈维护 (非后退且目标不同时压栈)
    if (!isBack && currentModule !== targetModule && currentModule !== 'landing') {
      routerHistory.push(currentModule);
    }
    currentModule = targetModule;

    // 2. 停止或启动首页 3D 渲染与导航栏显隐
    if (targetModule === 'landing') {
      landingVisualizer.start();
      if (globalNavbar) globalNavbar.classList.add('hidden');
    } else {
      landingVisualizer.stop();
      if (globalNavbar) globalNavbar.classList.remove('hidden');
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
      if (document.documentElement) document.documentElement.scrollTop = 0;
    }

    // 3. 全局顶栏元素联动
    if (studioQuickActions) {
      if (targetModule === 'studio') {
        studioQuickActions.classList.remove('hidden');
      } else {
        studioQuickActions.classList.add('hidden');
      }
    }

    if (bcCurrentPage) {
      bcCurrentPage.textContent = moduleTitles[targetModule] || targetModule;
    }

    // 4. 切换页面隐藏/显示
    Object.keys(allPages).forEach(key => {
      const pageEl = allPages[key];
      if (!pageEl) return;
      if (key === targetModule) {
        pageEl.classList.remove('hidden');
      } else {
        pageEl.classList.add('hidden');
      }
    });

    // 5. 更新顶栏选项卡高亮
    navTabs.forEach(tab => {
      const tabTarget = tab.getAttribute('data-nav');
      if (tabTarget === targetModule) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // 6. 更新 URL Hash
    if (targetModule === 'landing') {
      if (window.location.hash) window.location.hash = '';
    } else {
      if (window.location.hash !== '#' + targetModule) {
        window.location.hash = targetModule;
      }
    }

    return true;
  }
  function backTarget() { return routerHistory.length ? routerHistory.pop() : 'studio'; }

  return { navigate, backTarget, getCurrentModule: () => currentModule };
});
