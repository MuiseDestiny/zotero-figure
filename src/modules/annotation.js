function flattenChars(structuredText) {
  let flatCharsArray = [];
  for (let paragraph of structuredText.paragraphs) {
    for (let line of paragraph.lines) {
      for (let word of line.words) {
        for (let charObj of word.chars) {
          flatCharsArray.push(charObj);
        }
      }
    }
  }
  return flatCharsArray;
}
function rectsDist([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2]) {
  let left = bx2 < ax1;
  let right = ax2 < bx1;
  let bottom = by2 < ay1;
  let top = ay2 < by1;

  if (top && left) {
    return Math.hypot(ax1 - bx2, ay2 - by1);
  }
  else if (left && bottom) {
    return Math.hypot(ax1 - bx2, ay1 - by2);
  }
  else if (bottom && right) {
    return Math.hypot(ax2 - bx1, ay1 - by2);
  }
  else if (right && top) {
    return Math.hypot(ax2 - bx1, ay2 - by1);
  }
  else if (left) {
    return ax1 - bx2;
  }
  else if (right) {
    return bx1 - ax2;
  }
  else if (bottom) {
    return ay1 - by2;
  }
  else if (top) {
    return by1 - ay2;
  }

  return 0;
}
function getClosestOffset(chars, rect) {
  let dist = Infinity;
  let idx = 0;
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    let distance = rectsDist(ch.rect, rect);
    if (distance < dist) {
      dist = distance;
      idx = i;
    }
  }
  return idx;
}
function getPositionBoundingRect(position, pageIndex) {
  // Use nextPageRects
  if (position.rects) {
    let rects = position.rects;
    if (position.nextPageRects && position.pageIndex + 1 === pageIndex) {
      rects = position.nextPageRects;
    }
    if (position.rotation) {
      let rect = rects[0];
      let tm = getRotationTransform(rect, position.rotation);
      let p1 = applyTransform([rect[0], rect[1]], tm);
      let p2 = applyTransform([rect[2], rect[3]], tm);
      let p3 = applyTransform([rect[2], rect[1]], tm);
      let p4 = applyTransform([rect[0], rect[3]], tm);
      return [
        Math.min(p1[0], p2[0], p3[0], p4[0]),
        Math.min(p1[1], p2[1], p3[1], p4[1]),
        Math.max(p1[0], p2[0], p3[0], p4[0]),
        Math.max(p1[1], p2[1], p3[1], p4[1]),
      ];
    }
    return [
      Math.min(...rects.map(x => x[0])),
      Math.min(...rects.map(x => x[1])),
      Math.max(...rects.map(x => x[2])),
      Math.max(...rects.map(x => x[3]))
    ];
  }
  else if (position.paths) {
    let x = position.paths[0][0];
    let y = position.paths[0][1];
    let rect = [x, y, x, y];
    for (let path of position.paths) {
      for (let i = 0; i < path.length - 1; i += 2) {
        let x = path[i];
        let y = path[i + 1];
        rect[0] = Math.min(rect[0], x);
        rect[1] = Math.min(rect[1], y);
        rect[2] = Math.max(rect[2], x);
        rect[3] = Math.max(rect[3], y);
      }
    }
    return rect;
  }
}
function getFlattenedCharsByIndex(pdfPages, pageIndex) {
  let structuredText = pdfPages[pageIndex].structuredText;
  return flattenChars(structuredText);
}
function getSortIndex(pdfPages, position) {
  let { pageIndex } = position;
  let offset = 0;
  let top = 0;
  if (pdfPages[position.pageIndex]) {
    let chars = getFlattenedCharsByIndex(pdfPages, position.pageIndex);
    let viewBox = pdfPages[position.pageIndex].viewBox;
    let rect = getPositionBoundingRect(position);
    offset = chars.length && getClosestOffset(chars, rect) || 0;
    let pageHeight = viewBox[3] - viewBox[1];
    top = pageHeight - rect[3];
    if (top < 0) {
      top = 0;
    }
  }
  return [
    pageIndex.toString().slice(0, 5).padStart(5, '0'),
    offset.toString().slice(0, 6).padStart(6, '0'),
    Math.floor(top).toString().slice(0, 5).padStart(5, '0')
  ].join('|');
}
function _generateObjectKey() {
  let len = 8;
  let allowedKeyChars = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ';

  var randomstring = '';
  for (var i = 0; i < len; i++) {
    var rnum = Math.floor(Math.random() * allowedKeyChars.length);
    randomstring += allowedKeyChars.substring(rnum, rnum + 1);
  }
  return randomstring;
}

async function generateImageAnnotation(Zotero, Zotero_Tabs, pageIndex, rect, comment, tag) {
  const reader = Zotero.Reader.getByTabID(Zotero_Tabs._tabs[Zotero_Tabs.selectedIndex].id)
  const pdfPages = reader._internalReader._primaryView._pdfPages
  const attachment = reader._item
  const annotation = {
    type: 'image',
    color: "#f0bbcd",
    pageLabel: pageIndex + 1,
    position: {
      pageIndex: pageIndex,
      rects: [rect]
    }
  };
  annotation.sortIndex = getSortIndex(pdfPages, annotation.position)
  annotation.key = _generateObjectKey();
  // reader._internalReader._annotationManager.addAnnotation(annotation)
  
  annotation.pageLabel = annotation.pageLabel || '';
  annotation.text = annotation.text || '';
  annotation.comment = comment;
  annotation.tags = [tag];
  // Automatically set properties
  annotation.id = _generateObjectKey();
  annotation.dateCreated = (new Date()).toISOString();
  annotation.dateModified = annotation.dateCreated;
  annotation.authorName = undefined;
  annotation.isAuthorNameAuthoritative = false;
  
  // Ensure numbers have 3 or less decimal places
  if (annotation.position.rects) {
    annotation.position.rects = annotation.position.rects.map(
      rect => rect.map(value => parseFloat(value.toFixed(3)))
    );
  }
  
  await Zotero.Annotations.saveFromJSON(attachment, annotation);
  
  reader._internalReader._primaryView._render();
}
















