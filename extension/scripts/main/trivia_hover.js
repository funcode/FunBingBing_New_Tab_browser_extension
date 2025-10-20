const initTriviaHover = function () {
  const triviaOuter = document.querySelector('.hp_trivia_outer');
  const triviaInner = triviaOuter?.querySelector('.hp_trivia_inner');
  if (triviaOuter && triviaInner) {
    triviaInner.addEventListener('mouseenter', function () {
      triviaInner.className = 'hp_trivia_inner focusin';
      triviaInner.ariaExpanded = 'true';
    });
    triviaInner.addEventListener('mouseleave', function () {
      triviaInner.className = 'hp_trivia_inner';
      triviaInner.ariaExpanded = 'false';
    });
  }
}; 

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTriviaHover, { once: true });
} else {
  initTriviaHover();
}