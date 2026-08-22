
/* Aba Estoque V2 — acoplamento não invasivo ao nova.html.
   A tela principal continua intacta; este módulo só adiciona o item de navegação. */
(() => {
  const ID = 'estoque-addon-nav';
  function instalar() {
    const nav = document.querySelector('.side-nav nav');
    if (!nav || document.getElementById(ID)) return;
    const btn = document.createElement('button');
    btn.id = ID;
    btn.type = 'button';
    btn.innerHTML = '<i>▦</i><span>Estoque</span>';
    btn.title = 'Estoque operacional';
    btn.addEventListener('click', () => { window.location.href = './estoque.html'; });
    const botoes = [...nav.querySelectorAll('button')];
    const compras = botoes.find((b) => /compras/i.test(b.textContent || ''));
    if (compras?.nextSibling) nav.insertBefore(btn, compras.nextSibling); else nav.appendChild(btn);
  }
  instalar();
  const observer = new MutationObserver(() => instalar());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
