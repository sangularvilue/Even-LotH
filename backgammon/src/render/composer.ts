/**
 * Page Composer — 4 image tiles in a 2×2 grid (400×200).
 * No event capture container — onEvenHubEvent fires on real glasses regardless.
 * For simulator testing, use the phone UI control buttons.
 */

import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ImageContainerProperty,
} from '@evenrealities/even_hub_sdk';
import {
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  BOARD_DISPLAY_X,
  BOARD_DISPLAY_Y,
  CONTAINER_ID_TL, CONTAINER_ID_TR, CONTAINER_ID_BL, CONTAINER_ID_BR,
  CONTAINER_NAME_TL, CONTAINER_NAME_TR, CONTAINER_NAME_BL, CONTAINER_NAME_BR,
} from '../state/constants';

function buildImageTiles(): ImageContainerProperty[] {
  return [
    new ImageContainerProperty({
      xPosition: BOARD_DISPLAY_X,
      yPosition: BOARD_DISPLAY_Y,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      containerID: CONTAINER_ID_TL,
      containerName: CONTAINER_NAME_TL,
    }),
    new ImageContainerProperty({
      xPosition: BOARD_DISPLAY_X + IMAGE_WIDTH,
      yPosition: BOARD_DISPLAY_Y,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      containerID: CONTAINER_ID_TR,
      containerName: CONTAINER_NAME_TR,
    }),
    new ImageContainerProperty({
      xPosition: BOARD_DISPLAY_X,
      yPosition: BOARD_DISPLAY_Y + IMAGE_HEIGHT,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      containerID: CONTAINER_ID_BL,
      containerName: CONTAINER_NAME_BL,
    }),
    new ImageContainerProperty({
      xPosition: BOARD_DISPLAY_X + IMAGE_WIDTH,
      yPosition: BOARD_DISPLAY_Y + IMAGE_HEIGHT,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      containerID: CONTAINER_ID_BR,
      containerName: CONTAINER_NAME_BR,
    }),
  ];
}

export function composeStartupPage(): CreateStartUpPageContainer {
  const imageObjects = buildImageTiles();
  return new CreateStartUpPageContainer({
    containerTotalNum: imageObjects.length,
    imageObject: imageObjects,
  });
}

export function composePageForState(): RebuildPageContainer {
  const imageObjects = buildImageTiles();
  return new RebuildPageContainer({
    containerTotalNum: imageObjects.length,
    imageObject: imageObjects,
  });
}
