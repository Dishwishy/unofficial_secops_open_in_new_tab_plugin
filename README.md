# Overview

This is an unofficial plugin that restores some "right-click" > "open in new tab" behavior to the Google SecOps (TM) [Unified Rules](https://docs.cloud.google.com/chronicle/docs/detection/unified-rules/manage-unified-rules) Experience.

This was largely vibecoded and then checked by Codemender (TM) to ensure it was as safe as it could be.

# Example

This currently only works for custom rules, as curated content is not editable. However, the name of the rule now acts as a hyperlink that you can CMD+click or right click to open in a new tab.

![screenshot](/plugin_example.png?raw=true "Example Screenshot")

# Build/Pack

git clone this repo and then zip it!

`zip -r secops-rule-linker-v1.0.0.zip ./*`

---

## Privacy Policy

This plugin prioritizes user privacy. **It does not collect, store, transmit, or share any personal data, browsing history, or information** related to your Google SecOps environment. All code executes entirely within your local browser instance.

## License

This project is licensed under the **Apache License 2.0**. 

```text
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.