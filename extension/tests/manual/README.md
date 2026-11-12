# Check wallpaper downloads in headed Chromium

Run from the extension root with Playwright and its Chromium browser installed.

```sh
npm run test:native
```

Use the prompts in the terminal to drive the disposable browser profile.

1. Choose **Deny** in the first browser permission prompt.
2. On retry, grant Downloads permission. In the first **Save As** dialog, enter the absolute path printed in the terminal and save.
3. In the second **Save As** dialog, choose **Cancel**.

Wait for the terminal verdict. The command writes the observed permission, browser download, and saved-file results to `output/native-acceptance/wallpaper-download.json`. It exits with a failure status if a step times out or a check fails.
