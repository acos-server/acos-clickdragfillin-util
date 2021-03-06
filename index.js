  /*
  Utility functions for point-and-click, drag-and-drop, and text fill-in exercises.
  */
var Exercise, Util, cheerio, encodeSpecialCharsToUnicode, exercisesDirName, fs, nunjucks, path, recursiveReaddir, utilNjEnv,
  hasProp = {}.hasOwnProperty;

fs = require('fs');

path = require('path');

recursiveReaddir = require('recursive-readdir');

cheerio = require('cheerio');

nunjucks = require('nunjucks');

Exercise = require('./exercise');

// nunjucks views (templates)
utilNjEnv = nunjucks.configure(path.join(__dirname, 'views'));

// name of the directory in the content package that contains the exercises (XML files)
exercisesDirName = 'exercises';

// export object
Util = function() {};

// Adds a content package (at ACOS server startup)
Util.registerContentPackage = function(contentPackagePrototype, contentPackageDir) {
  var exercisesDir;
  // Autodiscover exercises: any XML file in the content package directory "exercises"
  // is assumed to be an exercise (with a corresponding JSON file). The files may be nested
  // in subdirectories.
  exercisesDir = path.join(contentPackageDir, exercisesDirName);
  return recursiveReaddir(exercisesDir, function(err, files) {
    var exerciseName, filepath, fullPath, j, len, order, results;
    // files include only files, no directories
    if (err) {
      console.error(err);
      throw err;
    }
    order = 0;
    results = [];
    for (j = 0, len = files.length; j < len; j++) {
      filepath = files[j];
      if (/\.xml$/.test(filepath)) {
        // since XML files in different subdirectories might be using the same filename,
        // we must keep the directory path in the exercise name (unique identifier within
        // the content package). Slash / characters are replaced with dashes - so that
        // the exercise names do not mess up URL paths. Assume that the XML files
        // are named without any dashes "-".
        fullPath = filepath;
        // Remove the leading directory path so that the path inside the exercises directory is left.
        filepath = filepath.substring(exercisesDir.length + 1);
        // warn the user if dashes "-" are used in the filename
        if (filepath.indexOf('-') !== -1) {
          console.warn(`The name of the exercise file ${fullPath} in the content package ${contentPackagePrototype.namespace} of content type ${contentPackagePrototype.contentTypeNamespace} contains dashes (-) even though it is not supported and should result in errors`);
        }
        filepath = filepath.replace(new RegExp(path.sep, 'g'), '-'); // replace / with -
        
        // Get the filename without the extension
        exerciseName = filepath.substring(0, filepath.length - 4);
        results.push(contentPackagePrototype.meta.contents[exerciseName] = {
          'title': exerciseName,
          'description': '',
          'order': order++
        });
      } else {
        results.push(void 0);
      }
    }
    return results;
  });
};

// Read and parse the exercise XML file and JSON payload.
// exerciseName: title of the exercise in the content package
// contentType: content type object
// contentPackage: content package object
// cache: object into which the parsed exercise is stored
//   property exercise: XML string,
//   property head: head content from the XML file as string
//   property payload: JSON payload as object, not string
// errorCallback: function that is called when reading or parsing the files fail
//   (called with one argument, the error object)
// callback: function that is called after successfully parsing the exercise

// Adds all the exercises into teaser contents.
// If disabled, teaser contents must be added manually in the exercise package.
// contentPackagePrototype.meta.teaserContent.push(exerciseName)
Util.readExerciseXML = function(exerciseName, contentType, contentPackage, cache, errorCallback, callback) {
  var filepath;
  filepath = exerciseName.replace(/-/g, path.sep); // replace - with /
  return fs.readFile(path.join(contentPackage.getDir(), exercisesDirName, filepath + '.xml'), 'utf8', function(err, xml_data) {
    var parser;
    if (err) {
      // no exercise file with this name, or other IO error
      // a user could manipulate URLs and probe different values
      console.error(err);
      errorCallback(err);
      return;
    }
    parser = new Exercise(contentType.namespace);
    return parser.parseXml(xml_data, function(err, tree, head) {
      var userDefinedJsonFilepath;
      if (err) {
        errorCallback(err);
        return;
      }
      
      // JSON file contains data for the interactive elements (correct/wrong, feedback, ...)
      userDefinedJsonFilepath = path.join(contentPackage.getDir(), exercisesDirName, filepath + '.json');
      return fs.readFile(userDefinedJsonFilepath, 'utf8', function(err, data) {
        var payload;
        if (err) {
          payload = {};
        } else {
          payload = JSON.parse(data);
        }
        
        // Add autogenerated payload
        payload = parser.jsonPayload(payload, tree);
        cache.exercise = tree.html({
          omitRoot: true
        });
        cache.head = head != null ? head.html({
          omitRoot: true
        }) : '';
        cache.payload = payload; // as object, not string
        return callback();
      });
    });
  });
};

// Initializes the exercise (called when a user starts an exercise)
// contentTypePrototype: content type object
// njEnv: nunjucks environment that has been configured with the path to the templates
//   of the content type (exercise_head.html and exercise_body.html)
// exerciseCache: exercise cache object of the content type
// req, params, handlers, cb: the same as in the initialize function of content types
Util.initializeContentType = function(contentTypePrototype, njEnv, exerciseCache, req, params, handlers, cb) {
  var cachedVal, contentPackage, readExerciseCallback, readExerciseErrorCallback;
  contentPackage = handlers.contentPackages[req.params.contentPackage];
  readExerciseCallback = function() {
    var cache;
    cache = exerciseCache[req.params.contentPackage][params.name];
    cache.headContent = njEnv.render('exercise_head.html', {
      headContent: cache.head,
      payload: JSON.stringify(cache.payload)
    });
    cache.bodyContent = njEnv.render('exercise_body.html', {
      exercise: cache.exercise
    });
    
    // parsed exercise data was added to the cache, now add it to the response
    params.headContent += cache.headContent;
    params.bodyContent += cache.bodyContent;
    return cb();
  };
  readExerciseErrorCallback = function(err) {
    params.bodyContent = Util.renderError(err);
    return cb();
  };
  if (exerciseCache[req.params.contentPackage] == null) {
    exerciseCache[req.params.contentPackage] = {};
  }
  if (exerciseCache[req.params.contentPackage][params.name] == null) {
    // not cached yet
    exerciseCache[req.params.contentPackage][params.name] = {};
    return Util.readExerciseXML(params['name'], contentTypePrototype, contentPackage, exerciseCache[req.params.contentPackage][params.name], readExerciseErrorCallback, readExerciseCallback);
  } else {
    cachedVal = exerciseCache[req.params.contentPackage][params.name];
    if ((cachedVal.headContent != null) && (cachedVal.bodyContent != null)) {
      params.headContent += cachedVal.headContent;
      params.bodyContent += cachedVal.bodyContent;
      // assume that the content package does not need to initialize anything (this content type takes
      // care of everything), so do not call the initialize function from the content package
      return cb();
    } else {
      // looks like the exercise XML has been stored in the cache but not the general exercise templates
      return readExerciseCallback();
    }
  }
};

Util.renderError = function(error) {
  return "<div class=\"alert-danger\">\n" + error.toString() + "\n</div>";
};

// write an event to the (content package specific) log
// logDirectory: path to the log directory of the ACOS server
// contentTypePrototype: content type object
// payload, req, protocolPayload: the same as in the handleEvent function of content types
Util.writeExerciseLogEvent = function(logDirectory, contentTypePrototype, payload, req, protocolPayload) {
  var dir;
  dir = logDirectory + `/${contentTypePrototype.namespace}/` + req.params.contentPackage;
  // path like log_dir/"contenttype"/"contentpackage", log files for each exercise will be created there
  return fs.mkdir(dir, 0o0775, function(err) {
    var data, filename;
    if (err && err.code !== 'EEXIST') {
      // error in creating the directory, the directory does not yet exist
      console.error(err);
      return;
    }
    filename = req.params.name + '.log';
    // the exercise name should be a safe filename for the log file too since
    // the exercise names are based on the XML filenames and the name parameter
    // has already passed the ACOS server URL router regular expression
    data = new Date().toISOString() + ' ' + JSON.stringify(payload) + ' ' + JSON.stringify(protocolPayload || {}) + '\n';
    return fs.writeFile(dir + '/' + filename, data, {
      flag: 'a'
    }, (function(err) {}));
  });
};

// Build final feedback HTML for a submission.
// The final feedback may be sent back to the frontend learning management system.
// contentType: content type object
// contentPackage: content package object
// contentTypeDir: string, path to the content type directory
// serverAddress: web address of the ACOS server, e.g., 'http://localhost:3000/'
// njEnv: nunjucks environment that has set the path to the templates (feedback.html)
// exerciseCache: exercise cache object of the content type
// eventPayload: payload parameter from the handleEvent method of the content type.
//   It contains the grading payload from the frontend JS code of the content type.
//   This function reads submission data (JSON) from the feedback property and
//   then overwrites the feedback property with the HTML feedback.
// req: req parameter from the handleEvent method of the content type
// payloadTransformerCallback: callback function that is given the payload object
//   and the server base address as argument. The function may modify the payload for
//   the final feedback, e.g., remove some unused properties and convert relative URLs to absolute.
//   The property answers from the eventPayload has been added to the payload
//   before calling the callback.
// cb: callback function that is called at the end. No arguments are supplied to
//   the function call, hence handleEvent should wrap its own callback since
//   it requires arguments.
Util.buildFinalFeedback = function(contentType, contentPackage, contentTypeDir, serverAddress, njEnv, exerciseCache, eventPayload, req, payloadTransformerCallback, cb) {
  var readCallback, readErrorCallback;
  readCallback = function() {
    var cache, finalComment, iframeContent, payload;
    cache = exerciseCache[req.params.contentPackage][req.params.name];
    
    // deep copy cache.payload object before modification
    // do not add the answers property to the object in the cache
    payload = JSON.parse(JSON.stringify(cache.payload));
    if (eventPayload.feedback.answers != null) {
      payload.answers = eventPayload.feedback.answers;
    } else {
      payload.answers = {};
    }
    if (serverAddress[serverAddress.length - 1] === '/') {
      
      // remove trailing slash /
      serverAddress = serverAddress.substr(0, serverAddress.length - 1);
    }
    finalComment = Util.getFinalComment(eventPayload.points, payload.finalcomment);
    
    // call the callback from the content type to modify the payload
    // (different content types may use different structures in the JSON payload)
    payloadTransformerCallback(payload, serverAddress);
    iframeContent = njEnv.render('feedback.html', {
      exercise: cache.exercise,
      payload: JSON.stringify(payload),
      headContent: cache.head,
      score: eventPayload.points,
      correctAnswers: eventPayload.feedback.correctAnswers,
      incorrectAnswers: eventPayload.feedback.incorrectAnswers,
      serverUrl: serverAddress,
      finalComment: finalComment
    });
    // encode special characters <, >, ", ', \, &, and line terminators to unicode literals (\uXXXX)
    // so that the feedback HTML document can be written to a JS string literal
    // inside a <script> element without breaking the browser HTML parsers
    iframeContent = encodeSpecialCharsToUnicode(iframeContent);
    // overwrite the submission data with the real feedback HTML
    // the feedback is embedded in an <iframe>
    eventPayload.feedback = utilNjEnv.render('feedback-iframe.html', {
      iframeContent: iframeContent,
      serverUrl: serverAddress,
      iframeId: Util.randomId('acos-feedback-')
    });
    return cb();
  };
  readErrorCallback = function(err) {
    eventPayload.feedback = Util.renderError(err);
    return cb();
  };
  if (exerciseCache[req.params.contentPackage] == null) {
    exerciseCache[req.params.contentPackage] = {};
  }
  if (exerciseCache[req.params.contentPackage][req.params.name] == null) {
    // not cached yet
    exerciseCache[req.params.contentPackage][req.params.name] = {};
    return Util.readExerciseXML(req.params.name, contentType, contentPackage, exerciseCache[req.params.contentPackage][req.params.name], readErrorCallback, readCallback);
  } else {
    // render feedback, exercise XML has been cached previously
    return readCallback();
  }
};

// encode special characters <, >, ", ', \, &, and line terminators to unicode literals (\uXXXX)
encodeSpecialCharsToUnicode = function(str) {
  return str.replace(/[\\<>"'&\n\r\u2028\u2029]/g, function(char) {
    switch (char) {
      case '\\':
        return '\\u005c';
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '"':
        return '\\u0022';
      case "'":
        return '\\u0027';
      case '&':
        return '\\u0026';
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return char;
    }
  });
};

// Return the final comment HTML string for the given score (0-100) and
// the comment payload (object that may have keys "common" and the score limits).
// The lowest score limit is activated of the limits that the score is less than or equal to.
Util.getFinalComment = function(score, payload) {
  var feedbackIdx, html, key, limit, limits, val;
  if (payload == null) {
    return '';
  }
  html = '';
  if (payload.common) {
    // always show this comment
    html += payload.common + '<br>';
  }
  limits = [];
  for (key in payload) {
    if (!hasProp.call(payload, key)) continue;
    val = payload[key];
    limit = parseInt(key, 10);
    if (!isNaN(limit)) {
      limits.push([limit, key]);
    }
  }
  limits.sort(function(a, b) {
    if (a[0] < b[0]) {
      return -1;
    } else if (a[0] > b[0]) {
      return 1;
    } else {
      return 0;
    }
  });
  feedbackIdx = limits.findIndex(function(elem) {
    return score <= elem[0];
  });
  if (feedbackIdx !== -1) {
    html += payload[limits[feedbackIdx][1]];
  }
  return html;
};

Util.randomId = function(prefix = 'id', length = 15) {
  var chars, i, n, res;
  chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  n = chars.length;
  // pick random characters (as many as the value of length)
  res = (function() {
    var j, ref, results;
    results = [];
    for (i = j = 1, ref = length; (1 <= ref ? j <= ref : j >= ref); i = 1 <= ref ? ++j : --j) {
      results.push(chars.charAt(Math.floor(Math.random() * n)));
    }
    return results;
  })();
  return prefix + res.join('');
};

Util.convertRelativeUrlsInHtmlStrings = function(obj, serverAddress) {
  var key, results, str;
  results = [];
  for (key in obj) {
    if (!hasProp.call(obj, key)) continue;
    str = obj[key];
    results.push(obj[key] = convertRelativeUrlsInHtml(str, serverAddress));
  }
  return results;
};

Util.convertRelativeUrlsInHtml = function(htmlStr, serverAddress) {
  var $, attrName, tag, tagAttrPairs;
  // convert relative URLs in the HTML string, e.g., in src attributes of <img> elements
  // the URLs are made absolute using serverAddress as the target
  $ = cheerio.load(htmlStr);
  tagAttrPairs = {
    'img': 'src',
    'a': 'href',
    'script': 'src',
    'iframe': 'src',
    'link': 'href'
  };
  for (tag in tagAttrPairs) {
    if (!hasProp.call(tagAttrPairs, tag)) continue;
    attrName = tagAttrPairs[tag];
    $(tag).attr(attrName, function(idx, val) {
      if (val) {
        return convertUrlToAbsoluteUrl(val, serverAddress);
      }
    });
  }
  // if the attr was not set, return nothing so no new attr is set
  // return $.html() # return the modified HTML string, but it has unwanted <html> element
  // cheerio adds <html>, <head>, and <body> to every HTML fragment: get the real contents
  return $('body').html();
};

Util.convertUrlToAbsoluteUrl = function(url, serverAddress) {
  var absoluteRegExp;
  absoluteRegExp = /^(#|\/\/|\w+:)/;
  if (!absoluteRegExp.test(url)) { // if not absolute URL
    // assume that url is a root-relative URL (starts with "/" like "/static/...")
    return serverAddress + url;
  } else {
    return url;
  }
};

//##########################
//# ACOS server interface ##
//##########################
//Util.initialize = (req, params, handlers, cb) ->
// this is a library that provides utilities to other modules,
// hence this does not render any content of its own
//  cb()
Util.register = function(handlers, app, conf) {
  return handlers.libraries['clickdragfillin-util'] = Util;
};

Util.namespace = 'clickdragfillin-util';

Util.packageType = 'library';

Util.meta = {
  'name': 'clickdragfillin-util',
  'shortDescription': 'Utility functions for point-and-click, drag-and-drop, and text fill-in exercises',
  'description': 'Utility functions for point-and-click, drag-and-drop, and text fill-in exercises',
  'author': 'Markku Riekkinen',
  'license': 'MIT',
  'version': '0.3.0',
  'url': ''
};

Util.Exercise = Exercise;

module.exports = Util;
