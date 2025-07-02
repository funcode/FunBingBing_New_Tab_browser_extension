document.addEventListener('DOMContentLoaded', function () {
  var hdln_div = document.getElementById('headline_div');
  var hdln_txt = document.getElementById('headline');
  var desc = document.getElementById('description');
  if (!hdln_div || !desc) return;
  // 鼠标移入按钮，显示 description，隐藏按钮
  hdln_txt.addEventListener('mouseenter', function() {
    desc.style.display = 'block';
    hdln_div.style.display = 'none';
  });
  // 鼠标移出 description 区域，恢复按钮显示，隐藏 description
  desc.addEventListener('mouseleave', function() {
    desc.style.display = 'none';
    hdln_div.style.display = 'block';
  });
}); 