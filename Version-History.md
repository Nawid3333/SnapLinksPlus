#summary Version history of Snap Links Plus
=Version History=

<h2>2.3.1</h2>
<p>3 Sep 2012, Clint Priest & Tommi Rautava</p>
<ul>
<li>FIXED: Selection did not grab links below of shown window even if it was scrolled down.</li>
</ul>

<h2>2.3.0</h2>
<p>2 Sep 2012, Clint Priest & Tommi Rautava</p>
<ul>
<li>ADDED: Ability to lasso radio buttons, currently it will highlight any radio button found (ignoring radio groups) and will click all selected radio buttons which will result in the "last clicked" radio button to be selected. This is probably not perfectly desirable but is good enough for now. Better solution would be to outline only the radio button which would BE selected.</li>
<li>ADDED: Option to specify action when checkboxes have a mixed state, three options: Check All, Uncheck All (default), Toggle.</li>
<li>ADDED: "Switch to first new tab created" checkbox and functionality.</li>
<li>ADDED: Firefox 15 support.</li>
<li>CHANGE: It is now possible to select elements in sub-iframe elements, the selection rectangle maintains an origin plane of the top document while calculating for intersected elements within local coordinate planes (of frames).</li>
<li>FIXED: Selection rectangles are now being properly offset by sub-document IFRAMEs.</li>
<li>FIXED: Issue 21: The selection rectangle does not work correctly with IFRAME elements.</li>
<li>FIXED: scrollViewOffset() was not functioning for bottom/right intrusions.</li>
<li>FIXED: Fixed the outline issue from FF13 on (MozOutline no longer support, standardly supported now as .outline).</li>
<li>FIXED: Addressed the escapeHTML() and htmlentities() issues presented by AMO team @ mozilla.</li>
</ul>

<h2>2.2.1</h2>
<p>11 Dec 2011, Tommi Rautava</p>
<ul><li>Translations updated from Babelzilla. 8 translations excluded: bg, ca-AD, cs, fr, hr-HR, ru, vi, zh-TW.</li>
<li>Positioning of the tooltip that shows the number of selected links has been improved. The tooltip is now always visible and stays within the page area.</li>
</ul>

<h2>2.2</h2>
<p>9 Dec 2011, Tommi Rautava</p>
<ul><li>Added an option to configure the link separator. The separator is used when
links are copied to clipboard.</li>
<li>Added an option to configure delay between actions. This is used e.g. when
links are opened to new tabs.</li>
<li>Added an option to allow download to the selected downloads directory without
prompting. The option is enabled only when the global Always ask me where to
save files is not in use.</li>
<li>Added Hebrew and Swedish translations.</li>
<li>Added screen edge scroll.</li>
<li>Excluded incomplete translations: bg, ca-AD, cs, fr, hr-HR, ru, vi, zh-TW.</li>
</ul>

<h2>2.1.1</h2>
<p>28 Sep 2011, Tommi Rautava</p>
<ul>
<li>Changed: Marked as compatible with Firefox 8.0a2 and SeaMonkey 2.5a2.</li>
<li>Added released translations: German, Portuguese (Portugal)</li>
</ul>

<h2>2.1</h2>
<p>29 Jul 2011, Clint Priest & Tommi Rautava</p>
<ul>
<li>Fixed issue 1: Showing of Addon Bar Link Counts.</li>
<li>Fixed issue 2: Hidden links are no longer opened.</li>
<li>Fixed issue 3: Cancel command removed from the popup menu.</li>
<li>Fixed issue 4: When HTML input elements have illegal IDs, use alternative methods to get access on the elements.</li>
<li>Fixed Issue 5: Broken "Bookmark All" function has been fixed.</li>
<li>Fixed Issue 6: Select behavior in about:config, about:addons.</li>
<li>Fixed Issue 7: Showing count of selected links regardless of preference.</li>
<li>Added: Showing of Hovering Link Counts.</li>
<li>Added: Option for controlling location of number of links shown.</li>
<li>Added: Support for JavaScript links <i>(experimental)</i>.</li>
<li>Changed: Options dialog restructured into panes.</li>
<li>Changed: Action menu rearranged.</li>
<li>Changed: Replaced styled separator elements with normal menu separator elements on the popup menu.</li>
<li>Changed: Marked as compatible with Firefox 6 and SeaMonkey 2.3.</li>
<li>Excluded: Incomplete translations: Bulgarian, Catalan, German, French, Croatian, Portuguese (Portugal), Vietnamese, Chinese (Traditional)</li>
</ul>

<h2>2.0.1</h2>
<p>4 Jul 2011, Tommi Rautava</p>
<ul>
<li>Fixed: New tabs were not opened next to the current tab.</li>
</ul>

<h2>2.0</h2>
<p>2 Jul 2011, Clint Priest & Tommi Rautava</p>
<ul>
<li>Major rework (by Clint Priest).</li>
<li>Added: Highlight checkboxes within selection rectangle for clicking.</li>
<li>Added: Highlight buttons within selection rectangle for clicking.</li>
<li>Added: Remove duplicate links from selected urls before performing action.</li>
<li>Added: Hide selection rectangle when mouse leaves window.</li>
<li>Added: New translations: Bulgarian (bg), Serbian (sr), Swedish (sv-SE).</li>
<li>Updated: Extension icon.</li>
<li>Removed: Open links when mouse leaves window.</li>
<li>Removed: Hold the Alt key to move selection.</li>
<li>Removed: Incomplete translations removed temporarily: ca-AD, de, hr-HR, vi, zh-TW.</li>
<li>Note: Requires Firefox 4.0/5.0 or SeaMonkey 2.1.</li>
</ul>

<h2>1.0.13</h2>
<p>22 Jun 2011, Tommi Rautava</p>
<ul>
<li>Update: Installs on Firefox 5.0.</li>
</ul>

<h2>1.0.12</h2>
<p>19 Jun 2011, Tommi Rautava</p>
<ul>
<li>Fixed: Missing native Firefox context menu on MacOS and Linux.</li>
</ul>

<h2>1.0.11</h2>
<p>2 Apr 2011, Tommi Rautava</p>
<ul>
<li>Fixed: Context menu position.</li>
<li>Fixed: Context menu looks on Firefox 4.0.</li>
</ul>

<h2>1.0.10</h2>
<p>1 Apr 2011, Tommi Rautava</p>
<ul>
<li>Fixed: Brazilian Portuguese (pt-BR) translation.</li>
</ul>

<h2>1.0.9</h2>
<p>25 Mar 2011, Tommi Rautava</p>
<ul>
<li>Update: Installs on Firefox 4.0.</li>
<li>Update: Installs on Seamonkey 2.1.</li>
</ul>

<h2>1.0.8</h2>
<p>24 Jan 2010, Tommi Rautava</p>
<ul>
<li>Fixed: Right-click context menu issues.</li>
</ul>

<h2>1.0.7</h2>
<p>22 Jan 2010, Tommi Rautava</p>
<ul>
<li>Fixed: Scroll position calculation on Firefox 3.6.</li>
</ul>

<h2>1.0.6</h2>
<p>17 Jan 2010, Tommi Rautava</p>
<ul>
<li>Fixed: Open links in a new window.</li>
</ul>

<h2>1.0.5</h2>
<p>15 Jan 2010, Tommi Rautava</p>
<ul>
<li>Added: Spanish, Croatian and Turkish translations.</li>
<li>Added: Support for SeaMonkey 2.0 (experimental).</li>
</ul>

<h2>1.0.4.1</h2>
<p>11 Jan 2010, Tommi Rautava</p>
<ul>
<li>Fixed: French translation.</li>
</ul>

<h2>1.0.4</h2>
<p>9 Jan 2010, Tommi Rautava</p>
<ul>
<li>Updated: French and Portuguese (Brazilian) translations.</li>
</ul>

<h2>1.0.3</h2>
<p>9 Jan 2010, Tommi Rautava</p>
<ul>
<li>Added: Support for Firefox 3.6.</li>
</ul>

<h2>1.0.2</h2>
<p>26 May 2009, Tommi Rautava</p>
<ul>
<li>Fixed: When opening multiple images to new tabs the first context menu on the first selected tab was incorrect.</li>
<li>Fixed: The plugin blocked the spell checking feature on Firefox.</li>
<li>Added: Vietnamese (Vietnam) language support has been added.</li>
</ul>

<h2>1.0.1</h2>
<p>5 February 2009, Tommi Rautava</p>
<ul>
<li>Portuguese language support fixed.</li>
</ul>

<h2>1.0</h2>
<p>22 January 2009, Tommi Rautava</p>
<ul>
<li>Name changed to Snap Links Plus.</li>
<li>Added locale: Czech (cs-CZ).</li>
</ul>

<h2>0.0.8</h2>
<p>7 December 2008, Tommi Rautava</p>
<ul>
<li>Added locale: Russian (ru-RU).</li>
</ul>

<h2>0.0.7</h2>
<p>6 December 2008, Tommi Rautava</p>
<ul>
<li>Added extension description.</li>
<li>Made a minor update to the options dialog.</li>
</ul>

<h2>0.0.6</h2>
<p>4 December 2008, Tommi Rautava</p>
<ul>
<li>Updated version compatibility for Firefox 3.1</li>
<li>Included locales: ca-AD, de-DE, en-US, fi-FI, fr-FR, hu-HU, it-IT, ja-JP, nl-NL, pl-PL, pt-BR, pt-PT, sk-SK, zh-CN, zh-TW</li>
</ul>

<h2>0.0.5</h2>
<p>May 2008, Atreus and MumblyJuergens</p>
<ul>
<li>Updated for Firefox 3</li>
</ul>

<h2>0.0.4</h2>
<p>8 September 2007, Pedro Fonseca (savred)</p>
<ul>
<li>Added new actions (open links in new windows, in tabs on a new window, copy, download and bookmark)</li>
<li>Added an action popup menu (Ctrl + Release Mouse button)</li>
<li>Added options to change the thickness and color of the boxes</li>
<li>Some bugs were fixed</li>
<li>Improved the drawing smoothness</li>
<li>Included locales: en-US, fr-FR, it-IT, nl-NL, pl-PL, pt-PT</li>
</ul>

<h3>Acknowledgements</h3>
These persons helped improve the extension:
<ul>
<li>Goffy</li>
<li>David</li>
<li>Todd Worth</li>
</ul>

The following persons also contributed by translating Snap Links:
<ul>
<li>l0stintranslation</li>
<li>myahoo</li>
<li>markh</li>
<li>teo</li>
</ul>

<p>I also thank the other users who supported in other ways, some of 
them by giving feedback and encouragement. Their valuable contribute 
made possible many bug corrections and added features over the 
initial version of the extension.</p>

<p>Pedro Fonseca, savred -at- gmail.com, 09-Sep-2007</p>

<h2>0.0.3</h2>
<p>17 January 2007, Pedro Fonseca (savred)</p>