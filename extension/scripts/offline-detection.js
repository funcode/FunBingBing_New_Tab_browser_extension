// Offline detection script
console.log('Current online status:', navigator.onLine);

window.addEventListener('online', function() {
    console.log('Network status changed to: online');
});


// 添加实际网络连接测试
function checkActualConnection() {
    return fetch('https://www.bing.com/favicon.ico', {
        mode: 'no-cors',
        cache: 'no-cache'
    })
    .then(() => {
        console.log('Actual network test: Connected');
        return true;
    })
    .catch(() => {
        console.log('Actual network test: Disconnected');
        return false;
    });
}

// 定期检查实际网络状态
setInterval(checkActualConnection, 30000);

// 初始检查
checkActualConnection();

if (!navigator.onLine) {
  window.location.href = 'newtab.html';
}

window.addEventListener('offline', function() {
  window.location.href = 'newtab.html';
  console.log('Network status changed to: offline');
});