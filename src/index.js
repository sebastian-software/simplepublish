import { resolve, relative } from "path"

import { rollup } from "rollup"
import uglify from "rollup-plugin-uglify"
import relink from "rollup-plugin-relink"
import nodeResolve from "rollup-plugin-node-resolve"
import builtinModules from "builtin-modules"

import readPackage from "read-package-json"
import denodeify from "denodeify"
import { eachSeries } from "async"
import { camelCase } from "lodash"

import es2015 from "./config/es2015"
import latestloose from "./config/latestloose"
import latest from "./config/latest"
import react from "./config/react"
import stage2 from "./config/stage2"
import stage3 from "./config/stage3"

const pkg = require(resolve(process.cwd(), "package.json"))
const external = Object.keys(pkg.dependencies).concat(builtinModules)
const externalsMap = {}
for (var i=0, l=external.length; i<l; i++) {
  externalsMap[external[i]] = true
}

const extensions = [ ".js", ".jsx", ".es5", ".es6", ".es", ".json" ]

const transpilerConfig =
{
  es2015,
  latestloose,
  latest,
  react,
  stage2,
  stage3
}

var cache

denodeify(readPackage)(resolve("package.json")).then((pkg) =>
{
  // Read entry file from command line... fallback to typical default location
  var entry = process.argv[2] || "src/index.js"
  var banner = `/*! ${pkg.name} v${pkg.version} by ${pkg.author.name} */`
  var formats = pkg.browser ? [ "es", "cjs", "umd", "umd-min" ] : [ "es", "cjs" ]

  var moduleId = pkg.name
  var moduleName = camelCase(pkg.name)

  const outputFolder = process.argv[3] ? process.argv[3] : "lib"
  const outputFileMatrix = {
    "cjs": outputFolder ? `${outputFolder}/index.js` : pkg.main || null,
    "es": outputFolder ? `${outputFolder}/index.es.js` : pkg.module || pkg["jsnext:main"] || null,
    "umd": outputFolder ? `${outputFolder}/index.umd.js` : pkg.browser || null,
    "umd-min": outputFolder ? `${outputFolder}/index.umd.min.js` : pkg.browser.replace(".js", ".min.js") || null
  }

  eachSeries(formats, (format, callback) =>
  {
    console.log(`Bundling ${pkg.name} v${pkg.version} as ${format}...`)

    var fileFormat = format.split("-")[0]
    var fileMode = format.split("-")[1]

    var fileRelink = relink({ outputFolder })

    var transpilationMode = "react"

    return rollup({
      entry: entry,
      cache,
      onwarn: (msg) => console.warn(msg),
      external: function(pkg)
      {
        if (fileRelink.isExternal(pkg)) {
          return true
        }

        if (pkg.charAt(0) === "/")
        {
          var rel = relative(process.cwd(), pkg)
          return Boolean(/node_modules/.exec(rel))
        }

        return pkg.charAt(0) !== "."
      },
      plugins:
      [
        nodeResolve({ extensions, jsnext: true, module: true, main: true }),
        transpilerConfig[transpilationMode],
        fileRelink,
        fileMode === "min" ? uglify() : null
      ].filter((plugin) => Boolean(plugin))
    })
    .then((bundle) =>
      bundle.write({
        format: fileFormat,
        moduleId,
        moduleName,
        banner,
        sourceMap: true,
        dest: outputFileMatrix[format]
      })
    )
    .then(() =>
      callback(null)
    )
    .catch((err) =>
    {
      console.error(err)
      callback(`Error during bundling ${format}: ${err}`)
    })
  })
})
.catch((err) =>
{
  console.error("Error while building: ", err)
  process.exit(1)
})
