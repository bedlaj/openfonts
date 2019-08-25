require("shelljs/global")
const fs = require("fs")

module.exports = function(url, dest, cb) {
  const script = `wget -O ${dest} ${url} --tries 5 -T 120`
  console.log(script)
  exec(script)
  cb()
}
