const _ = require('lodash');
const express = require('express');
const Discord = require('discord.js');

const { CanvasEx, ImageEx } = require('./imageex');

const twemoji = require('./twemoji');

const app = express();
const config = require('./config.default.json');

const filters = require('./filters.js');

try {
  _.extend(config, require('./config')); // eslint-disable-line global-require
} catch (err) {
  console.log('No config.json found!');
}

function all(x, c) {
  _.isArray(x) ? _.each(x, c) : c(x);
}

const { templates } = config;

_.each(templates, (template, templateName) => {
  const data = templates[templateName];
  all(data, templatePart => {
    templatePart.image = new ImageEx(templatePart.src);
  });
});

// drawing: we keep the image fixed in its default position and draw the template on top/below it

// calculates the x or y position of the template to be drawn
// size = width or height of the template/image
// anchor = the corresponding anchor config
function calculatePosition(scale, anchor, imageSize) {
  if (anchor.absolute) {
    return anchor.offset;
  }
  return imageSize * anchor.position / 100 - anchor.offset * scale;
}

// global variable, can be used to get the previous template calculations
let previousCalculation; // eslint-disable-line no-unused-vars
function getNumericAnchor(anchor, imgWidth, imgHeight) { // eslint-disable-line no-unused-vars
  return _.mapValues(anchor, dimension =>
    _.mapValues(dimension, value => (Number.isFinite(value) ? Number(value) : eval(value)))); // eslint-disable-line no-eval
}

function render(template, img, size, flipH) {
  let imgWidth = img.width;
  let imgHeight = img.height;
  if (size && size.height) {
    imgHeight = size.height;
    if (!size.width) imgWidth = imgWidth * size.height / img.height;
  }
  if (size && size.width) {
    imgWidth = size.width;
    if (!size.height) imgHeight = imgHeight * size.width / img.width;
  }

  console.log('Drawing template: ', template);
  const anchor = getNumericAnchor(template.anchor, imgWidth, imgHeight);
  console.log('Numeric anchor: ', anchor);
  const xScale = imgWidth / anchor.x.size;
  const yScale = imgHeight / anchor.y.size;
  const templateScale = Math.max(0, Math.min(10, Math.max(xScale || 0, yScale || 0)));

  let templateOffsetX;
  let templateOffsetY;
  templateOffsetX = calculatePosition(templateScale, anchor.x, imgWidth);
  templateOffsetY = calculatePosition(templateScale, anchor.y, imgHeight);

  console.log('xScale', xScale);
  console.log('yScale', yScale);
  console.log('templateOffsetX', templateOffsetX);
  console.log('templateOffsetY', templateOffsetY);

  let imageOffsetX = 0;
  let imageOffsetY = 0;
  let resultingWidth = imgWidth; // start with the image boundaries as defined by the image
  let resultingHeight = imgHeight;

  if (templateOffsetX < 0) {
    resultingWidth -= templateOffsetX;
    imageOffsetX = -templateOffsetX;
    templateOffsetX = 0;
  }
  if (templateOffsetY < 0) {
    resultingHeight -= templateOffsetY;
    imageOffsetY = -templateOffsetY;
    templateOffsetY = 0;
  }
  if (templateOffsetX + template.image.width * templateScale > resultingWidth) {
    resultingWidth = templateOffsetX + template.image.width * templateScale;
  }
  if (templateOffsetY + template.image.height * templateScale > resultingHeight) {
    resultingHeight = templateOffsetY + template.image.height * templateScale;
  }

  previousCalculation = {
    templateOffsetX,
    templateOffsetY,
    resultingWidth,
    resultingHeight,
    xScale,
    yScale,
    templateScale
  };
  const toDraw = [{
    z: 1,
    image: img,
    x: flipH ? resultingWidth - imageOffsetX - imgWidth : imageOffsetX,
    y: imageOffsetY,
    h: imgHeight,
    w: imgWidth,
    name: 'image'
  }, {
    z: template.z || 0,
    image: template.image,
    x: templateOffsetX,
    y: templateOffsetY,
    h: template.image.height * templateScale,
    w: template.image.width * templateScale,
    name: `template ${template.src}`,
    flipH,
    attributes: template.attributes,
    filter: filters[template.filter]
  }].sort((u, v) => u.z - v.z);
  console.log('To draw:', toDraw);

  let canvas = new CanvasEx(resultingWidth, resultingHeight);

  for (let i = 0; i < toDraw.length; ++i) {
    const subject = toDraw[i];
    console.log(`Drawing ${subject.name}${subject.flipH ? ' (flipped)' : ''}`);
    try {
      const transform = {};
      if (subject.flipH) {
        transform.translate = [resultingWidth, 0];
        transform.scale = [-1, 1];
      }
      if (subject.filter) {
        canvas = subject.filter(canvas, subject.image, subject.x, subject.y, {
          width: subject.w, height: subject.h, transform, attributes: subject.attributes
        });
      } else {
        canvas.drawImage(subject.image, subject.x, subject.y, {
          width: subject.w, height: subject.h, transform, attributes: subject.attributes
        });
      }
    } catch (err) {
      console.error(err);
      throw new Error(JSON.stringify({ status: 400, error: 'Invalid template' }));
    }
  }

  // return the image and cache it
  return (canvas);
}

app.get('/debug/frame/', async (req, res) => {
  try {
    const img = new ImageEx(req.query.url);
    await img.loaded;
    console.log(img.frames);
    return img.frames[req.query.num].canvas.pngStream().pipe(res);
  } catch (err) {
    console.log(err);
    return res.status(400).end(err.message);
  }
});

app.get('/', async (req, res) => {
  try {
    var templateList = [];
    for (var key in templates) {
      if(templates.hasOwnProperty(key)) { //to be safe
        templateList.push(key);
      }
    }
    console.log(templateList);
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify(templateList));
  } catch (err) {
    console.log(err);
    return res.status(400).end(err.message);
  }
});

app.get('/:templateName/', async (req, res) => {
  if (!templates[req.params.templateName]) return res.status(404).end();
  try {
    if (!/^https?:/.test(req.query.url)) {
      return res.status(400).end('Invalid url!');
    }
  let direction = req.query.reverse === 'true' ? '\\' : '/';
  console.log('Got command ', direction, req.params.templateName, direction === '\\' ? 'flipped' : 'not flipped', req.query.url);
  result = new ImageEx(req.query.url);
  await result.loaded; // eslint-disable-line no-await-in-loop
  const templateData = templates[req.params.templateName];
  all(templateData, template => { // eslint-disable-line no-loop-func
    result = render(template, result, null, direction === '\\');
  });

    return result.export(res);
  } catch (err) {
    console.log(err);
    return res.status(400).end({'error': err.message});
  }
});

app.listen(config.http.port, () => {
  console.log(`Beebot app listening on port ${config.http.port}!`);
});


// Discord stuff


const client = new Discord.Client({
  autoReconnect: true
});
// manage roles permission is required
const invitelink = `https://discordapp.com/oauth2/authorize?client_id=${
  config.discord.client_id}&scope=bot&permissions=0`;
/* const authlink = `https://discordapp.com/oauth2/authorize?client_id=${
  config.discord.client_id}&scope=email`; */
console.log(`Bot invite link: ${invitelink}`);

client.login(config.discord.token).catch(error => {
  if (error) {
    console.error("Couldn't login: ", error.toString());
  }
});

const discordAvatarRegex = /(https:\/\/cdn.discordapp.com\/avatars\/\w+\/\w+\.(\w+)\?size=)(\w+)/;

async function findEmoji(message) {
  // find a user mention
  if (message.mentions.users.size > 0) {
    const mentionedUser = message.mentions.users.first();
    const mentionedMember = message.guild.members[mentionedUser.id];
    let avatarUrl = mentionedUser.displayAvatarURL;
    const avatarMatch = discordAvatarRegex.exec(avatarUrl);
    if (avatarMatch) {
      // const ext = avatarMatch[2];
      avatarUrl = `${avatarMatch[1]}128`;
    }
    return {
      name: mentionedMember ? mentionedMember.displayName : mentionedUser.username,
      id: mentionedUser.id,
      url: avatarUrl,
      ext: avatarUrl.indexOf('.gif') >= 0 ? 'gif' : 'png'
    };
  }

  const str = message.cleanContent;
  // find a discord emote
  const discordEmote = /<(a?):(\w+):(\d+)>/g.exec(str);
  if (discordEmote) {
    const ext = discordEmote[1] === 'a' ? 'gif' : 'png';
    return {
      name: discordEmote[2],
      id: discordEmote[3],
      url: `https://cdn.discordapp.com/emojis/${discordEmote[3]}.${ext}`,
      ext
    };
  }

  // find a unicode emoji
  let unicodeEmoji;
  twemoji.parse(str, (name, emoji) => {
    if (unicodeEmoji) return false;
    unicodeEmoji = {
      name,
      id: name,
      url: `${emoji.base + emoji.size}/${name}${emoji.ext}`,
      ext: emoji.ext
    };
    return false;
  });
  if (unicodeEmoji) return unicodeEmoji;

  return null;
}

function reverseString(str) {
  return str.split('').reverse().join('');
}

const commands = Object.keys(templates).map(x => `/${x}`).join(', ');
const otherCommands = {
  invite: `Invite link: <${invitelink}>`,
  help: `Available commands: ${commands}.\nUse \\\\<command> to flip the template horizontally.\nInvite link: <${invitelink}>`,
  beebot: `Available commands: ${commands}.\nUse \\\\<command> to flip the template horizontally.\nInvite link: <${invitelink}>`
};


client.on('message', async message => {
  let commandParsed = /^([/\\])(\w+)\b/.exec(message.cleanContent);
  if (commandParsed) {
    const [, direction, command] = commandParsed;
    if (otherCommands[command]) {
      const text = otherCommands[command];
      message.channel.send(direction === '\\' ? reverseString(text) : text);
      return;
    }
  }

  if (message.cleanContent[0] === '/' || message.cleanContent[0] === '\\') {
    const messageSplit = message.cleanContent.split(' ');
    const emoji = await findEmoji(message);
    let result = null;
    let count = 0;
    try {
      if (emoji) {
        let { name } = emoji;
        for (let i = 0; i < messageSplit.length && count < 4; ++i) {
          commandParsed = /^([/\\])(\w+)\b/.exec(messageSplit[i]);
          if (commandParsed) {
            const [, direction, command] = commandParsed;
            if (templates[command]) {
              console.log('Got command ', direction, command, direction === '\\' ? 'flipped' : 'not flipped', emoji);
              count++;
              name += command;
              if (result === null) {
                result = new ImageEx(emoji.url);
                await result.loaded; // eslint-disable-line no-await-in-loop
              }
              const templateData = templates[command];
              all(templateData, template => { // eslint-disable-line no-loop-func
                result = render(template, result, null, direction === '\\');
              });
            }
          } else if (i === 0) return;
        }
        if (result) {
          const attachment = await result.toBuffer();
          const messageOptions = {
            files: [
              { attachment, name: `${name}.${emoji.ext}` }
            ]
          };
          console.log('Sending message with result:', result);
          await message.channel.send('', messageOptions).then(() => {
            console.log('Message sent!');
          }).catch(err => {
            console.error('Message sending failed:', err);
          });
        }
      }
    } catch (err) {
      console.error(err);
    }
  }
});

process.on('uncaughtException', exception => {
  console.log(exception);
});
