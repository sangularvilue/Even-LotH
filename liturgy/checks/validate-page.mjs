// Run the SDK's own page validator over the reading page we now build, so the
// 8-container budget / brightness / zOrder rules are checked without hardware.
import {
  TextContainerProperty, MenuContainerProperty, MenuItemProperty,
  validateEvenHubPageContainer, formatEvenHubPageContainerValidationError,
  isValidTextBrightness, isMenuNameWithinLimit, isValidMenuItemID,
} from '@evenrealities/even_hub_sdk'

const LINE_HEIGHT = 27, LINE_SLOTS = 7, TEXT_X = 6, TEXT_W = 576 - 12
const FOOTER_Y = 252, FOOTER_ID = 8, FOOTER_NAME = 'lit-footer'
const LEVELS = { body: 4, emphasis: 4, response: 3, heading: 3, rubric: 2, faint: 1 }

const lines = [
  { text: 'PSALMODY', tone: 'heading' },
  { text: 'Ant. 1  The Lord is my portion and my cup.', tone: 'emphasis' },
  { text: 'Psalm 16 - God is my portion, my inheritance', tone: 'heading' },
  { text: 'Preserve me, God, I take refuge in you.', tone: 'body' },
  { text: 'R/ For ever and ever.', tone: 'response' },
  { text: 'The psalm-prayer is said kneeling', tone: 'rubric' },
  { text: ' ', tone: 'body' },
]

const textObject = lines.map((l, i) => new TextContainerProperty({
  containerID: i + 1, containerName: `lit-line-${i}`, content: l.text,
  xPosition: TEXT_X, yPosition: i * LINE_HEIGHT, width: TEXT_W, height: LINE_HEIGHT,
  borderWidth: 0, paddingLength: 0, textColor: LEVELS[l.tone], isEventCapture: 0,
}))
textObject.push(new TextContainerProperty({
  containerID: FOOTER_ID, containerName: FOOTER_NAME, content: '\u2501'.repeat(12) + '\u2500'.repeat(18),
  xPosition: TEXT_X, yPosition: FOOTER_Y, width: TEXT_W, height: LINE_HEIGHT,
  borderWidth: 0, paddingLength: 0, textColor: LEVELS.faint, isEventCapture: 1,
}))

const menuObject = new MenuContainerProperty({
  menuItems: [
    ['Next hour', 1], ['Previous hour', 2], ['Scroll mode', 3],
    ['Recentre tilt', 4], ['Hour list', 5], ['Close', 6],
  ].map(([itemName, itemID]) => new MenuItemProperty({ itemName, itemID })),
})

const page = { containerTotalNum: textObject.length, textObject, menuObject }
const res = validateEvenHubPageContainer(page)
console.log('containers:', textObject.length)
console.log('vertical extent:', FOOTER_Y + LINE_HEIGHT, '/ 288')
console.log('brightness all valid:', textObject.every(c => isValidTextBrightness(c.textColor)))
console.log('menu labels within limit:', menuObject.menuItems.every(m => isMenuNameWithinLimit(m.itemName)))
console.log('menu ids valid:', menuObject.menuItems.every(m => isValidMenuItemID(m.itemID)))
console.log('capture containers:', textObject.filter(c => c.isEventCapture === 1).length)
console.log('validate:', res.valid ? 'VALID' : 'INVALID — ' + formatEvenHubPageContainerValidationError(res))
process.exit(res.valid ? 0 : 1)
