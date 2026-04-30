(function (self) {
  var _Interp = null;
  var _getInterp = null;
  var _eval = null;
  var _getStringResult = null;
  var _Result = null;

  var _OnReadyCb = function (obj) {};
  
  var _TclException = function(errCode, errInfo) {
    this.errorCode = errCode;
    this.errorInfo = errInfo;
    this.toString = function() {
      return "TclException: " + this.errorCode + " => " + this.errorInfo;
    }
  }
  
  var _wasmbly = (function (url) {
    return new Promise(function(resolve, reject) {
      var wasmXHR = new XMLHttpRequest();
      wasmXHR.open('GET', url, true);
      wasmXHR.responseType = 'arraybuffer';
      wasmXHR.onload = function() { resolve(wasmXHR.response); }
      wasmXHR.onerror = function() { reject('error '  + wasmXHR.status); }
      wasmXHR.send(null);
    });
  })('wacl/wacl.wasm');
  
  var Module;
  if (typeof Module === 'undefined') Module = eval('(function() { try { return Module || {} } catch(e) { return {} } })()');

  Module['preRun'] = [];
  Module['noInitialRun'] = false;
  Module['noExitRuntime'] = true;
  Module['print'] = function(txt) { console.log('wacl stdout: ' + txt); };
  Module['printErr'] = function(txt) { console.error('wacl stderr: ' + txt); };
  Module['filePackagePrefixURL'] = 'wacl/';
  Module['instantiateWasm'] = function(imports, successCallback) {
    _wasmbly.then(function(wasmBinary) {
      var wasmInstantiate = WebAssembly.instantiate(new Uint8Array(wasmBinary), imports).then(function(output) {
        Module.testWasmInstantiationSucceeded = 1;
        successCallback(output.instance);
      }).catch(function(e) {
        console.log('wasm instantiation failed! ' + e);
      });
    });
    return {};
  };
  
  Module['postRun'] = function () {
    _getInterp = Module.cwrap('Wacl_GetInterp', 'number', []);
    _eval = Module.cwrap('Tcl_Eval', 'number', ['number', 'string']);
    _getStringResult = Module.cwrap('Tcl_GetStringResult', 'string', ['number']);
    _Interp = _getInterp();
    
    _Result = {
      Module: Module,
     
      set stdout(fn) {
        Module.print = fn;
      },
      set stderr(fn) {
        Module.printErr = fn;
      },
      get interp() {
        return _Interp;
      },
      
      str2ptr: function (strObj) {
        return Module.allocate(
                    Module.intArrayFromString(strObj), 
                    'i8', 
                    Module.ALLOC_NORMAL);
      },
      
      ptr2str: function (strPtr) {
        return Module.UTF8ToString(strPtr);
      },
     
      jswrap: function(fcn, returnType, argType) {
        // Back-compat: single-argument form, argType is a string.
        if (typeof argType === 'string') {
          var fnPtr = Runtime.addFunction(fcn);
          return "::wacl::jscall " + fnPtr + " " + returnType + " " + argType;
        }

        // Multi-argument form: argType is an array of type names. Wrap fcn
        // so wasm only ever sees the fixed signature (string -> returnType).
        // The wrapper receives a packed Tcl-list string, splits it, coerces
        // each element back to its declared type, then calls the user fn.
        var argTypes = argType;
        var coerce = function(s, t) {
          switch (t) {
            case 'int': case 'bool': return parseInt(s, 10);
            case 'double':           return parseFloat(s);
            default:                 return s;  // string / array
          }
        };
        var wrapper = function(packedPtr) {
          var packed = Module.UTF8ToString(packedPtr);
          var parts = _Result._parseTclList(packed);
          var args = new Array(argTypes.length);
          for (var i = 0; i < argTypes.length; i++) {
            args[i] = coerce(parts[i], argTypes[i]);
          }
          return fcn.apply(null, args);
        };
        var fnPtr = Runtime.addFunction(wrapper);
        return "::wacl::jscall " + fnPtr + " " + returnType + " string";
      },

      // Tcl-list parser: splits a Tcl list string into an array of elements,
      // honoring `{}` grouping and `\` escapes (the same syntax produced by
      // Tcl_GetString on a Tcl_Obj built via Tcl_NewListObj).
      _parseTclList: function(s) {
        var out = [];
        var i = 0, n = s.length;
        while (i < n) {
          while (i < n && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i++;
          if (i >= n) break;
          var token = '';
          if (s[i] === '{') {
            var depth = 1; i++;
            while (i < n && depth > 0) {
              var c = s[i];
              if (c === '\\' && i + 1 < n) { token += s[i + 1]; i += 2; continue; }
              if (c === '{') depth++;
              else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
              token += c; i++;
            }
          } else {
            while (i < n && s[i] !== ' ' && s[i] !== '\t' && s[i] !== '\n') {
              if (s[i] === '\\' && i + 1 < n) { token += s[i + 1]; i += 2; continue; }
              token += s[i]; i++;
            }
          }
          out.push(token);
        }
        return out;
      },
     
      Eval: function(str) {
        _eval(this.interp, 'catch {' + str + '} ::jsResult');
        var errCode = _getStringResult(this.interp);
        if (errCode != 0) {
          _eval(this.interp, 'set ::errorInfo');
          var errInfo = _getStringResult(this.interp);
          throw new _TclException(errCode, errInfo);
        } else {
          _eval(this.interp, 'set ::jsResult');
          return _getStringResult(this.interp); 
        }
      }
    };

    _OnReadyCb(_Result);
  };
