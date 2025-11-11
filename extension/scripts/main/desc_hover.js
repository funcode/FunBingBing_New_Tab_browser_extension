const initDescriptionHover = function () {
  var hdln_div = document.getElementById('headline_div');
  var hdln_txt = document.getElementById('headline');
  var desc = document.getElementById('description');
  var quote = document.getElementById('quote');
  if (!hdln_div || !desc || !quote) return;
  // 鼠标移入按钮，显示 description，隐藏按钮
  hdln_txt.addEventListener('mouseenter', function() {
    desc.style.display = 'block';
    hdln_div.style.display = 'none';
    quote.dataset.prevDisplay = quote.style.display || '';
    quote.style.display = 'none'; // 隐藏 quote
  });
  // 鼠标移出 description 区域，恢复按钮显示，隐藏 description
  desc.addEventListener('mouseleave', function() {
    desc.style.display = 'none';
    hdln_div.style.display = 'block';
    const prevDisplay = quote.dataset.prevDisplay !== undefined ? quote.dataset.prevDisplay : '';
    quote.style.display = prevDisplay; // 恢复 quote 显示状态
    delete quote.dataset.prevDisplay;
  });
}; 

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDescriptionHover, { once: true });
} else {
  initDescriptionHover();
}