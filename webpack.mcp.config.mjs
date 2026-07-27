import { resolve } from 'node:path';

export default {
  mode: 'production',
  target: 'node',
  entry: './src/mcp/server.ts',
  output: {
    path: resolve('build'),
    filename: 'mcp-helper.cjs',
    library: { type: 'commonjs2' }
  },
  module: {
    rules: [{
      test: /\.ts$/,
      exclude: /node_modules/,
      use: { loader: 'ts-loader', options: { transpileOnly: true } }
    }]
  },
  resolve: { extensions: ['.ts', '.js'] },
  devtool: false
};
