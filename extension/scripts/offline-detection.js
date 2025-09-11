// Offline detection script
console.log('Current online status:', navigator.onLine);

// Configurable endpoint for actual network test
const NETWORK_TEST_URL = 'https://jsonplaceholder.typicode.com/posts/1';

window.addEventListener('online', function() {
    window.location.href = 'blank.html';
    console.log('Network status changed to: online');
});

window.addEventListener('offline', function() {
  redirectToNewTabIfNeeded();
  console.log('Network status changed to: offline');
});


// 添加实际网络连接测试
function checkActualConnection() {
    return fetch(NETWORK_TEST_URL, {
        cache: 'no-cache'
    })
    .then(response => {
        if (response.ok) {
            console.log('Actual network test: Connected');
            return true;
        } else {
            console.log('Actual network test: Disconnected (bad status)');
            return false;
        }
    })
    .catch(() => {
        console.log('Actual network test: Disconnected');
        return false;
    });
}

// 可配置的实际网络状态检查间隔（以毫秒为单位）
const connectionCheckInterval = 30000; // 30秒，可根据需要调整

// 定期检查实际网络状态
setInterval(checkActualConnection, connectionCheckInterval);

// 初始检查
checkActualConnection();

function redirectToNewTabIfNeeded() {
  if (!window.location.pathname.endsWith('newtab.html')) {
    window.location.href = 'newtab.html';
  }
}

if (!navigator.onLine) {
  redirectToNewTabIfNeeded();
}