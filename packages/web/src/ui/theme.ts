type Theme = 'system' | 'light' | 'dark';
const KEY = 'agent-village-theme';
const isTheme = (value: unknown): value is Theme => value === 'system' || value === 'light' || value === 'dark';

export function initTheme(select: HTMLSelectElement): void {
  let theme: Theme = 'system';
  try {
    const saved = localStorage.getItem(KEY);
    if (isTheme(saved)) theme = saved;
  } catch { /* Storage can be blocked; system mode still works. */ }

  const apply = () => {
    select.value = theme;
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
  };
  apply();
  select.addEventListener('change', () => {
    if (!isTheme(select.value)) return;
    theme = select.value;
    apply();
    try { localStorage.setItem(KEY, theme); } catch (error) {
      console.warn('Could not save the theme preference.', error);
    }
  });
}
