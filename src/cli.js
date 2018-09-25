/* eslint-disable immutable/no-mutation */
/* eslint-disable tree-shaking/no-side-effects-in-initialization */

import { extname, dirname, isAbsolute, resolve } from "path"
import chalk from "chalk"
import { camelCase } from "lodash"
import { get as getRoot } from "app-root-dir"
import { rollup } from "rollup"

import babelPlugin from "rollup-plugin-babel"
import cjsPlugin from "rollup-plugin-commonjs"
import jsonPlugin from "rollup-plugin-json"
import replacePlugin from "rollup-plugin-replace"
import yamlPlugin from "rollup-plugin-yaml"
import { terser as terserPlugin } from "rollup-plugin-terser"
import executablePlugin from "rollup-plugin-executable"

import typescriptResolvePlugin from "./typescriptResolvePlugin"
import parseCommandline from "./parseCommandline"
import extractTypes from "./extractTypes"
import getBanner from "./getBanner"
import getEntries from "./getEntries"
import getOutputMatrix from "./getOutputMatrix"
import printSizeInfo from "./printSizeInfo"

const ROOT = getRoot()
const PKG_CONFIG = require(resolve(ROOT, "package.json"))

let cache

/* eslint-disable no-console */

const command = parseCommandline()

const verbose = command.flags.verbose
const quiet = command.flags.quiet

if (verbose) {
  console.log("Flags:", command.flags)
}

const name = PKG_CONFIG.name || camelCase(PKG_CONFIG.name)
const banner = getBanner(PKG_CONFIG)
const entries = getEntries(command)
const outputFileMatrix = getOutputMatrix(command, PKG_CONFIG)

async function bundleAll() {
  if (!outputFileMatrix.main) {
    console.warn(chalk.red.bold("Missing `main` entry in `package.json`!"))
  }

  if (entries.node) {
    console.log(">>> NodeJS Entry:", entries.node)

    await bundleTo({
      input: entries.node,
      target: "node",
      format: "cjs",
      output: outputFileMatrix.main
    })

    await bundleTo({
      input: entries.node,
      target: "node",
      format: "esm",
      output: outputFileMatrix.module
    })
  } else if (entries.library) {
    console.log(">>> Library Entry:", entries.library)
    if (outputFileMatrix.module) {
      await bundleTo({
        input: entries.library,
        target: "lib",
        format: "esm",
        output: outputFileMatrix.module
      })
    }

    if (outputFileMatrix.main) {
      await bundleTo({
        input: entries.library,
        target: "lib",
        format: "cjs",
        output: outputFileMatrix.main
      })
    }

    if (!entries.browser) {
      if (outputFileMatrix.umd) {
        await bundleTo({
          input: entries.library,
          target: "lib",
          format: "umd",
          output: outputFileMatrix.umd
        })
      }
    }

    if ([ ".ts", ".tsx" ].includes(extname(entries.library))) {
      if (outputFileMatrix.types) {
        console.log(
          `${chalk.green(">>> Extracting types from")} ${chalk.magenta(PKG_CONFIG.name)}-${chalk.magenta(
            PKG_CONFIG.version
          )} as ${chalk.blue("tsdef".toUpperCase())} to ${chalk.green(dirname(outputFileMatrix.types))}...`
        )

        extractTypes(entries.library, dirname(outputFileMatrix.types), verbose)
      } else {
        console.warn(chalk.red.bold("Missing `types` entry in `package.json`!"))
      }
    }
  }

  if (entries.browser) {
    console.log(">>> Browser Entry:", entries.node)

    if (outputFileMatrix.browser) {
      await bundleTo({
        input: entries.browser,
        target: "browser",
        format: "esm",
        output: outputFileMatrix.browser
      })
    }

    if (outputFileMatrix.umd) {
      await bundleTo({
        input: entries.browser,
        target: "lib",
        format: "umd",
        output: outputFileMatrix.umd
      })
    }
  }

  if (entries.binary) {
    console.log(">>> Binary Entry:", entries.binary)
    await bundleTo({
      input: entries.binary,
      target: "cli",
      format: "cjs",
      output: outputFileMatrix.binary
    })
  }

  console.log(chalk.green.bold("Done!"))
}

function isRelative(dependency) {
  return (/^\./).exec(dependency)
}

async function bundleTo({
  input,
  target,
  format,
  output
}) {
  if (!quiet) {
    /* eslint-disable max-len */
    console.log(
      `${chalk.green(">>> Bundling")} ${chalk.magenta(PKG_CONFIG.name)}-${chalk.magenta(
        PKG_CONFIG.version
      )} as ${chalk.blue(format.toUpperCase())} to ${chalk.green(output)}...`
    )
  }

  const prefix = "process.env."
  const variables = {
    [`${prefix}NAME`]: JSON.stringify(PKG_CONFIG.name),
    [`${prefix}VERSION`]: JSON.stringify(PKG_CONFIG.version),
    [`${prefix}TARGET`]: JSON.stringify(target)
  }

  const shebang = "#!/usr/bin/env node"

  const bundle = await rollup({
    input,
    cache,
    onwarn: (error) => {
      console.warn(chalk.red(`  - ${error.message}`))
    },
    external(dependency) {
      // Very simple externalization:
      // We exclude all files from NodeJS resolve basically which are not relative to current file.
      // We also bundle absolute paths, these are just an intermediate step in Rollup resolving files and
      // as we do not support resolving from node_modules (we never bundle these) we only hit this code
      // path for originally local dependencies.
      return !(dependency === input || isRelative(dependency) || isAbsolute(dependency))
    },
    plugins: [
      replacePlugin(variables),
      cjsPlugin({
        include: "node_modules/**"
      }),
      typescriptResolvePlugin(),
      yamlPlugin(),
      jsonPlugin(),
      babelPlugin({
        // Rollup Setting: Prefer usage of a common library of helpers
        runtimeHelpers: true,

        // The Babel-Plugin is not using a pre-defined include, but builds up
        // its include list from the default extensions of Babel-Core.
        // Default Extensions: [".js", ".jsx", ".es6", ".es", ".mjs"]
        // We add TypeScript extensions here as well to be able to post-process
        // any TypeScript sources with Babel. This allows us for using presets
        // like "react" and plugins like "fast-async" with TypeScript as well.
        extensions: [ ".js", ".jsx", ".es6", ".es", ".mjs", ".ts", ".tsx" ],

        // Do not transpile external code
        // https://github.com/rollup/rollup-plugin-babel/issues/48#issuecomment-211025960
        exclude: [ "node_modules/**", "**/*.json" ]
      }),
      format === "umd" || target === "cli" || (/\.min\./).exec(output) ? terserPlugin({
        toplevel: format === "esm" || format === "cjs",
        keep_classnames: true,
        keep_fnames: true,
        safari10: true,
        output: {
          ascii_only: true,
          semicolons: false
        }
      }) : null,
      target === "cli" ? executablePlugin() : null
    ].filter(Boolean)
  })

  const { code } = await bundle.write({
    format,
    name,
    banner: target === "cli" ? shebang + "\n\n" + banner : banner,
    sourcemap: command.flags.sourcemap,
    file: output
  })

  await printSizeInfo(code, output, target !== "cli")
}

bundleAll()
