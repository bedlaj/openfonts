## What

This is fork of awesome project [typefaces](https://github.com/KyleAMathews/typefaces), allowing to use different character subsets.

Each typeface package ships with all the necessary font files and css to
self-host an open source typeface.

All Google Fonts have been added as well.

## How

Couldn’t be easier. This is how you’d add Open Sans.

```
npm install --save @openfonts/open-sans_latin
```

Then in your app or site’s entry file.

```javascript
require("@openfonts/open-sans_latin")
```

And that’s it! You’re now self-hosting Open Sans!

It should take < 5 minutes to swap out Google Fonts.

Typeface assumes you’re using webpack with loaders setup for loading css
and font files (you can use Typeface with other setups but webpack makes
things really really simple). Assuming your webpack configuration is
setup correctly you then just need to require the typeface in the entry
file for your project.
