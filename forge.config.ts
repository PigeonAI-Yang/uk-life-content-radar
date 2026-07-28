import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'content-media-terminal',
    extraResource: [
      'build/mcp-helper.cjs',
      'skills/content-business-partner',
      'SKILL.md',
      'references/source-map.md',
      'node_modules/@img/sharp-win32-x64/lib/libvips-42.dll',
      'node_modules/@img/sharp-win32-x64/lib/libvips-cpp-8.18.3.dll'
    ]
  },
  rebuildConfig: { onlyModules: ['__forge_skip__'] },
  makers: [new MakerSquirrel({}), new MakerZIP({}, ['win32'])],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      loggerPort: 9001,
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [{
          html: './src/renderer/index.html',
          js: './src/renderer/index.tsx',
          name: 'main_window',
          preload: { js: './src/main/preload.ts' }
        }]
      }
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};

export default config;
