export const THEME_KEY = 'ziyun-theme';

// Apply the stored preference before the browser paints the page.
export const THEME_INIT = `(() => {
  let theme;
  try { theme = localStorage.getItem('${THEME_KEY}'); }
  catch (error) { console.debug('无法读取主题偏好', error); }
  document.documentElement.dataset.theme = theme === 'dark' || theme === 'light'
    ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();`;
