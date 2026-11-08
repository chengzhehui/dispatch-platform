// D3D11 is a Windows workaround. macOS uses Chromium's default graphics backend.
export const browserLaunchOptions = {
  headless: true,
  channel: 'chromium',
  args: process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-webgl'] : ['--enable-webgl'],
}
