import type { Configuration } from 'webpack';
import { typescriptRules } from './webpack.rules';

export const rendererConfig: Configuration = {
  module: {
    rules: [
      ...typescriptRules,
      { test: /\.css$/, use: ['style-loader', 'css-loader'] }
    ]
  },
  output: { publicPath: '../' },
  resolve: { extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'] }
};
