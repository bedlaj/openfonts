require("shelljs/global")
require("shelljs").config.silent = true
const requestSync = require(`sync-request`)
const async = require(`async`)
const fs = require(`fs-extra`)
const path = require(`path`)
const _ = require("lodash")

const {packageJson, fontFace, readme} = require(`./templates`)
const download = require(`./download-file`)
const commonWeightNameMap = require(`./common-weight-name-map`)

const baseurl = `https://google-webfonts-helper.herokuapp.com/api/fonts/`
//const baseurl = `http://localhost:9000/api/fonts/`
const id = process.argv[2]
if (!id) {
    console.warn(`You need to pass in the google font id as an argument`)
    process.exit()
}

// Get current count of packages to put in the package README
const dirs = p =>
    fs.readdirSync(p).filter(f => fs.statSync(p + "/" + f).isDirectory())
const packagesCount = dirs(`./packages`).length

const res = requestSync(`GET`, baseurl + id, {retry: true})
const defSubsetTypeface = JSON.parse(res.getBody(`UTF-8`))
const subsetsWithoutDefault = defSubsetTypeface.subsets.filter((subset) => subset !== defSubsetTypeface.defSubset)

const subsets = [[
    defSubsetTypeface.defSubset,
    defSubsetTypeface
]].concat(subsetsWithoutDefault.map((subset) => {
    const subsetRes = requestSync(`GET`, baseurl + id + '?subsets=' + defSubsetTypeface.defSubset + ',' + subset, {retry: true})
    return [subset, JSON.parse(subsetRes.getBody(`UTF-8`))]
}))

if (subsetsWithoutDefault.length > 1) {
    subsets.push([
        'all',
        JSON.parse(requestSync(`GET`, baseurl + id + '?subsets=' + defSubsetTypeface.defSubset + ',' + subsetsWithoutDefault.join()).getBody(`UTF-8`)), {retry: true}]
    )
}

//console.log(util.inspect(subsets, false, null, true))

subsets.forEach(subset => {
    const typefaceDir = `packages/${defSubsetTypeface.id}_${subset[0]}`

    // Create the directories for this typeface.
    fs.ensureDirSync(typefaceDir)
    fs.ensureDirSync(typefaceDir + `/files`)
    fs.ensureDirSync(typefaceDir + `/gstatic`)

    fs.writeFileSync(typefaceDir + `/.npmignore`, "/gstatic")

    const makeFontFilePath = (item, subsetName, extension) => {
        return makeFontFilePathInDirectory(item, subsetName, extension, './files')
    }

    const makeFontFilePathInDirectory = (item, subsetName, extension, directory) => {
        let style = ""
        if (item.fontStyle !== `normal`) {
            style = item.fontStyle
        }
        return `${directory}/${defSubsetTypeface.id}-${subsetName}-${item.fontWeight}${style ? '-' + style : ''}.${extension}`
    }

    // Download all font files.
    async.map(
        subset[1].variants,
        (item, callback) => {
            // Download woff, and woff2 in parallal.
            const downloads = [`woff`, `woff2`].map(extension => {
                const dest = path.join(typefaceDir, makeFontFilePath(item, subset[0], extension))
                const url = item[extension]
                return {
                    extension,
                    url,
                    dest,
                }
            })
            item.errored = false
            async.map(
                downloads,
                (d, downloadDone) => {
                    const {url, dest, extension} = d
                    download(url, dest, err => {
                        if (err) {
                            console.log("error downloading", defSubsetTypeface.id, url, err)
                            // Track if a download errored.
                            item.errored = true
                        } else {
                            const urlMarkerFile = path.join(typefaceDir, makeFontFilePathInDirectory(item, subset[0], extension, './gstatic'))
                            fs.writeFileSync(urlMarkerFile+'.link', url)
                        }
                        downloadDone()
                    })
                },
                callback
            )
        },
        (err, results) => {
            // If a hash file already exists, check if anything has changed.
            let changed = true
            if (fs.existsSync(`${typefaceDir}/files-last-modified.json`)) {
                const filesLastModifiedJson = JSON.parse(
                    fs.readFileSync(`${typefaceDir}/files-last-modified.json`, `utf-8`)
                )
                changed = filesLastModifiedJson.lastModified !== subset[1].lastModified
            }

            fs.writeFileSync(
                `${typefaceDir}/files-last-modified.json`,
                JSON.stringify({
                    lastModified: subset[1].lastModified,
                    version: subset[1].version
                })
            )

            // Write out the README.md
            const packageReadme = readme({
                typefaceId: defSubsetTypeface.id,
                typefaceSubset: subset[0],
                typefaceName: defSubsetTypeface.family,
                count: packagesCount,
            })

            fs.writeFileSync(`${typefaceDir}/README.md`, packageReadme)

            if (changed) {
                // Write out package.json file
                const packageJSON = packageJson({
                    typefaceId: defSubsetTypeface.id,
                    typefaceSubset: subset[0],
                    typefaceName: defSubsetTypeface.family,
                })

                fs.writeFileSync(`${typefaceDir}/package.json`, packageJSON)

                fs.writeFileSync(
                    `${typefaceDir}/font-descriptor.json`,
                    JSON.stringify(subset[1], null, 2)
                )
            }

            // Write out index.css file
            const variants = _.sortBy(subset[1].variants, item => {
                let sortString = item.fontWeight
                if (item.fontStyle === `italic`) {
                    sortString += item.fontStyle
                }
                return sortString
            })
            const css = variants.map(item => {
                if (item.errored) {
                    return false
                }
                return fontFace({
                    typefaceId: defSubsetTypeface.id,
                    typefaceSubset: subset[0],
                    typefaceName: defSubsetTypeface.family,
                    locals: item.local,
                    style: item.fontStyle,
                    weight: item.fontWeight,
                    commonWeightName: commonWeightNameMap(item.fontWeight),
                    woffPath: makeFontFilePath(item, subset[0], "woff"),
                    woff2Path: makeFontFilePath(item, subset[0], "woff2"),
                })
            })

            const cssPath = `${typefaceDir}/index.css`
            fs.writeFileSync(cssPath, css.join(""))
            console.log("finished downloading", defSubsetTypeface.family, subset[0], subset[1].storeID)
        }
    )
})
