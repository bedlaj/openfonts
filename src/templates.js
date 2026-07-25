'use strict'

// Byte-exact ports of the old lodash templates (scripts/templates.js in the
// pre-2020 repo). The formatting quirks are load-bearing: golden tests compare
// output against the tarballs actually published to npm.
//   - the comment style is "<id>-400normal - <subset>" / "<id>-400italic - <subset>"
//   - each local() line is indented 4; the LAST one ends with ", " (comma space)
//     because the old template emitted a space after closing the loop
//   - with no locals (the current gwfh API dropped them) the src: line keeps
//     that trailing space: "  src: \n    url(..."
//   - README starts with a blank line (old template literal began with \n)

function fontFace({typefaceId, typefaceSubset, typefaceName, style, weight, locals, woff2Path, woffPath}) {
  const localLines = (locals || []).map(l => `\n    local('${l}'),`).join('')
  return (
    `/* ${typefaceId}-${weight}${style} - ${typefaceSubset} */\n` +
    `@font-face {\n` +
    `  font-family: '${typefaceName}';\n` +
    `  font-style: ${style};\n` +
    `  font-display: swap;\n` +
    `  font-weight: ${weight};\n` +
    `  src:${localLines} \n` +
    `    url('${woff2Path}') format('woff2'), /* Chrome 26+, Opera 23+, Firefox 39+ */\n` +
    `    url('${woffPath}') format('woff'); /* Chrome 6+, Firefox 3.6+, IE 9+, Safari 5.1+ */\n` +
    `}\n`
  )
}

// files/<id>-<subset>-<weight>[-<style>].<ext>; the style suffix is omitted
// for fontStyle "normal".
function fontFilePath(fontId, subsetKey, variant, extension, directory = './files') {
  const style = variant.fontStyle !== 'normal' ? `-${variant.fontStyle}` : ''
  return `${directory}/${fontId}-${subsetKey}-${variant.fontWeight}${style}.${extension}`
}

// Old pipeline sorted variants by fontWeight + ("italic" if italic) as a
// STRING ("100" < "100italic" < "200" ...), via stable lodash sortBy.
function sortVariants(variants) {
  return variants
    .map((v, i) => [v.fontWeight + (v.fontStyle === 'italic' ? v.fontStyle : ''), i, v])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]))
    .map(e => e[2])
}

function indexCss(descriptor, subsetKey) {
  return sortVariants(descriptor.variants)
    .map(v =>
      fontFace({
        typefaceId: descriptor.id,
        typefaceSubset: subsetKey,
        typefaceName: descriptor.family,
        locals: v.local,
        style: v.fontStyle,
        weight: v.fontWeight,
        woff2Path: fontFilePath(descriptor.id, subsetKey, v, 'woff2'),
        woffPath: fontFilePath(descriptor.id, subsetKey, v, 'woff'),
      })
    )
    .join('')
}

function readme({typefaceId, typefaceSubset, typefaceName}) {
  return `
# ${typefaceId}_${typefaceSubset}

The CSS and web font files to easily self-host “${typefaceName}” with subset "${typefaceSubset}".

## Install

\`npm install --save @openfonts/${typefaceId}_${typefaceSubset}\`

## Use

Typefaces assume you’re using webpack to process CSS and files. Each typeface
package includes all necessary font files (woff2, woff) and a CSS file with
font-face declarations pointing at these files.

You will need to have webpack setup to load css and font files. Many tools built
with Webpack will work out of the box with Typefaces such as [Gatsby](https://github.com/gatsbyjs/gatsby)
and [Create React App](https://github.com/facebookincubator/create-react-app).

To use, simply require the package in your project’s entry file e.g.

\`\`\`javascript
// Load ${typefaceName} typeface
require('@openfonts/${typefaceId}_${typefaceSubset}')
\`\`\`

Usage in SCSS:
\`\`\`scss
@import "~@openfonts/${typefaceId}_${typefaceSubset}/index.css";
\`\`\`
`
}

// Replaces the old lerna-serialized package.json. `openfonts.sourceFingerprint`
// lets future runs skip unchanged packages straight from the registry packument.
function packageJson({fontId, subsetKey, family, version, fingerprint, builtAt}) {
  return {
    name: `@openfonts/${fontId}_${subsetKey}`,
    version,
    description: `${family} ${subsetKey} typeface`,
    main: 'index.css',
    keywords: ['typeface', 'font', 'font family', 'google fonts', fontId, subsetKey],
    author: 'Jan Bednar <openfonts@janbednar.eu>',
    license: 'MIT',
    repository: 'https://github.com/bedlaj/openfonts',
    publishConfig: {access: 'public'},
    openfonts: {sourceFingerprint: fingerprint, builtAt},
  }
}

module.exports = {fontFace, fontFilePath, sortVariants, indexCss, readme, packageJson}
