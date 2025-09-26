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

  const widgetsToggle = document.getElementById('widgets-toggle');
  const clockDisplay = document.getElementById('center-clock');
  const quoteContainer = document.getElementById('quote');
  const switchOn = document.getElementById('switch-on');
  const switchOff = document.getElementById('switch-off');

  // Set initial visibility based on config
  if (String(readConf('show_clock')) === 'no') {
    if(clockDisplay) clockDisplay.style.visibility = 'hidden';
    if(switchOn) switchOn.style.display = 'none';
    if(switchOff) switchOff.style.display = 'inline';
  }
  // Quote initial visibility:
  (function(){
    if (!quoteContainer) return;
    var showQuoteConf = String(readConf('show_quote'));
    if (showQuoteConf === 'no') {
      quoteContainer.style.display = 'none';
    } else {
      quoteContainer.style.display = '';
    }
  })();

  if (widgetsToggle && clockDisplay && switchOn && switchOff) {
    widgetsToggle.addEventListener('click', function() {
      // Determine current combined state based on clock visibility
      var clockHidden = getComputedStyle(clockDisplay).visibility === 'hidden';
      var willBeVisible = clockHidden; // if currently hidden -> show both; else hide both
      // Apply to clock
      clockDisplay.style.visibility = willBeVisible ? 'visible' : 'hidden';
      // Apply to quote (quote uses display property in other code; we force here)
      if (willBeVisible) {
        quoteContainer.style.display = '';
      } else {
        quoteContainer.style.display = 'none';
      }
      // Update switch icons
      if (willBeVisible) {
        switchOn.style.display = 'inline';
        switchOff.style.display = 'none';
      } else {
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

