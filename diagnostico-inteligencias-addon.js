/* Diagnóstico das Inteligências — acesso técnico, sem alterar o motor do nova.html. */
(() => {
  const ID_DESKTOP = 'tb-diagnostico-inteligencias-desktop';
  const ID_MOBILE = 'tb-diagnostico-inteligencias-mobile';
  const destino = './diagnostico-inteligencias.html';

  function botao(id, mobile) {
    const b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.title = 'Saúde das inteligências';
    b.innerHTML = '<i>◎</i><span>Diagnóstico</span>';
    b.addEventListener('click', () => { window.location.href = destino; });
    if (mobile) b.style.flex = '1 0 82px';
    return b;
  }

  function instalar() {
    const desktop = document.querySelector('.side-nav nav');
    if (desktop && !document.getElementById(ID_DESKTOP)) desktop.appendChild(botao(ID_DESKTOP, false));

    const mobile = document.querySelector('nav.mobile-nav');
    if (mobile && !document.getElementById(ID_MOBILE)) mobile.appendChild(botao(ID_MOBILE, true));
  }

  instalar();
  const observer = new MutationObserver(instalar);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
