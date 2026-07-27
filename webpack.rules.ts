import type { RuleSetRule } from 'webpack';

export const nativeRules: RuleSetRule[] = [
  {
    test: /native_modules[/\\].+\.node$/,
    use: 'node-loader'
  },
  {
    test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
    parser: { amd: false },
    use: {
      loader: '@vercel/webpack-asset-relocator-loader',
      options: { outputAssetBase: 'native_modules' }
    }
  }
];

export const typescriptRules: RuleSetRule[] = [
  {
    test: /\.tsx?$/,
    exclude: /(node_modules|\.webpack)/,
    use: { loader: 'ts-loader', options: { transpileOnly: true } }
  }
];
