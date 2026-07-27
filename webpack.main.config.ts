import type { Configuration } from 'webpack';
import { nativeRules, typescriptRules } from './webpack.rules';

export const mainConfig: Configuration = {
  entry: './src/main/index.ts',
  module: { rules: [...nativeRules, ...typescriptRules] },
  resolve: { extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'] }
};
