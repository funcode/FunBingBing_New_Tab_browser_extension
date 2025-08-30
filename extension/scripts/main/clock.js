'use strict';
(function(){
  function two(n){ return n < 10 ? '0' + n : '' + n; }
  function render(){
    var now = new Date();
    var text = two(now.getHours()) + ':' + two(now.getMinutes());
    var el = document.getElementById('center-clock');
    if (el) el.textContent = text;
  }
  function alignAndStart(){
    var now = new Date();
    var ms = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    if (ms < 0) ms = 0;
    setTimeout(function(){
      render();
      setInterval(render, 60000);
    }, ms);
  }
  render();
  alignAndStart();
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) render();
  });

  const clockContainer = document.getElementById('clock-container');
  const clockToggle = document.getElementById('clock-toggle');
  const clockDisplay = document.getElementById('center-clock');
  const switchOn = document.getElementById('switch-on');
  const switchOff = document.getElementById('switch-off');

  // Set initial visibility based on config
  if (String(readConf('show_clock')) === 'no') {
    if(clockDisplay) clockDisplay.style.visibility = 'hidden';
    if(switchOn) switchOn.style.display = 'none';
    if(switchOff) switchOff.style.display = 'inline';
  }

  if (clockToggle && clockDisplay && switchOn && switchOff) {
    clockToggle.addEventListener('click', function() {
      if (clockDisplay.style.visibility === 'hidden') {
        clockDisplay.style.visibility = 'visible';
        switchOn.style.display = 'inline';
        switchOff.style.display = 'none';
      } else {
        clockDisplay.style.visibility = 'hidden';
        switchOn.style.display = 'none';
        switchOff.style.display = 'inline';
      }
    });
  }

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.type === 'clockVisibilityChange') {
      if (clockDisplay && switchOn && switchOff) {
        clockDisplay.style.visibility = request.visible ? 'visible' : 'hidden';
        if (request.visible) {
          switchOn.style.display = 'inline';
          switchOff.style.display = 'none';
        } else {
          switchOn.style.display = 'none';
          switchOff.style.display = 'inline';
        }
      }
    }
  });
})();

