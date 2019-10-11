import path from "path"

import chalk from "chalk"
import figures from "figures"
import isCi from "is-ci"
import prettyBytes from "pretty-bytes"
import terminalSpinner from "ora"
import getTasks from "./getTasks"

const DEFAULT_LIMIT = 50

export function formatDuration(start) {
  const NS_PER_SEC = 1e9
  const NS_TO_MS = 1e6
  const diff = process.hrtime(start)
  const nano = diff[0] * NS_PER_SEC + diff[1]

  return `${Math.round(nano / NS_TO_MS)}ms`
}

function normalizePath(id) {
  return path
    .relative(process.cwd(), id)
    .split(path.sep)
    .join("/")
}

export default function progressPlugin(options = {}) {
  let loaded, start
  let { prefix, limit, task } = options

  const root = process.cwd()

  if (isCi) {
    return {
      name: "progress"
    }
  }

  if (!limit) {
    limit = DEFAULT_LIMIT
  }

  if (!prefix) {
    prefix = `Bundling:`
  }

  return {
    name: "progress",

    buildStart() {
      start = process.hrtime()
      loaded = 0
    },

    load(id) {
      loaded += 1
    },

    transform(code, id) {
      const file = normalizePath(id)
      if (file.includes(":")) {
        return
      }

      const short = file.slice(-limit)
      task.output = `${prefix} ${short !== file ? figures.ellipsis : ""}${short} [${loaded}]`
    }
  }
}
