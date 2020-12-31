/* eslint-disable */
var webpack = require('webpack');
var HtmlWebpackInlineSourcePlugin = require('html-webpack-inline-source-plugin');
var HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = env => {
  return {
    plugins: [
      new HtmlWebpackPlugin({
        inlineSource: '.(js|css)$',
        template: __dirname + `/public/index.html`,
        filename: __dirname + `/dist/index.html`,
        inject: 'head',
      }),
      new HtmlWebpackInlineSourcePlugin(),
      new webpack.EnvironmentPlugin({
        IS_LOCAL: process.env.npm_config_is_local === 'true' ? 'true' : 'false'
      })
    ],
    entry: ['./public/client.ts'],
    resolve: {
      extensions: ['.webpack.js', '.web.js', '.ts', '.tsx', '.js'],
    },
    output: {
      path: __dirname + '/dist',
      filename: `bundle.js`,
      publicPath: '/',
      libraryTarget: 'var',
      library: `app_bundle`,
    },
    module: {
      rules: [
        {
          test: /\.(svg)$/,
          loader: 'raw-loader',
        },
        {
          test: /\.tsx?$/,
          loader: 'ts-loader',
        },
        {
          test: /\.css$/,
          use: [{
            loader: 'style-loader',
            options: {
              insert: 'head',
            },
          }, {
            loader: 'css-loader',
          }, {
            loader: 'postcss-loader',
            options: {
              plugins: function () {
                return [
                  require('precss'),
                  require('autoprefixer')
                ];
              },
            },
          }]
        },
      ],
    },
    mode: 'development',
    performance: {
      hints: false,
    },
  }
}