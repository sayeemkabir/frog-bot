// Renders slide HTML files to 1920x1080 PNGs with Electron (offscreen).
//   npx electron scripts/video/render.cjs <job.json>
// job.json: [{ "html": "C:/…/slide1.html", "png": "C:/…/slide1.png" }, …]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, webPreferences: { offscreen: true } });
  for (const job of jobs) {
    await win.loadFile(job.html);
    await new Promise((r) => setTimeout(r, 400));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(job.png, image.toPNG());
    console.log('rendered', job.png);
  }
  app.quit();
});
