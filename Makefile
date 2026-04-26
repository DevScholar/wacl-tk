# Tcl version. Relies on tcl-core$(TCLVERSION) being vailable at sourceforge
TCLVERSION?=8.6.6
TKVERSION?=8.6.6
TDOMVERSION?=0.8.3
RLJSONVERSION?=0.9.7

INSTALLDIR=jsbuild
EMSCRIPTEN?=$(HOME)/.local/lib/emsdk/upstream/emscripten

# em-x11 Xlib replacement: Tk is compiled against em-x11's X11/*.h and
# linked against its static archive at demo time. The header dir must be
# a directory containing an X11/ subtree (matching Xlib's expected layout).
EMX11_DIR?=$(CURDIR)/../em-x11
EMX11_INCLUDES=$(EMX11_DIR)/native/include
EMX11_LIBDIR=$(EMX11_DIR)/build/artifacts

WASMLIBS=$(INSTALLDIR)/lib/libtcl8.6.a \
	   $(INSTALLDIR)/lib/tdom$(TDOMVERSION)/libtdom$(TDOMVERSION).a \
	   $(INSTALLDIR)/lib/rl_json$(RLJSONVERSION)/librl_json$(RLJSONVERSION).a

# Optimisation to use for generating bc
BCFLAGS?=-Oz -s WASM=1
#BCFLAGS?=-O0 -g4 -s WASM=1


# post-js happens later to write cwrap code conditional on tcl distro
WASMFLAGS=\
	--pre-js preGeneratedJs.js --post-js js/postJsRequire.js $(BCFLAGS) \
		-s FORCE_FILESYSTEM=1 -s ALLOW_TABLE_GROWTH=1 \
			--closure=0 \
		-s EXPORTED_RUNTIME_METHODS='["cwrap","UTF8ToString","allocate","intArrayFromString","ALLOC_NORMAL","addFunction"]'
	#-s FORCE_ALIGNED_MEMORY=1 -s CLOSURE_COMPILER=1 -s CLOSURE_ANNOTATIONS=1\
	#-s NODE_STDOUT_FLUSH_WORKAROUND=0 -s RUNNING_JS_OPTS=1

WACLEXPORTS=\
	-s EXPORTED_FUNCTIONS="['_main','_Wacl_GetInterp','_Tcl_Eval','_Tcl_GetStringResult']"

.PHONY: all wacl.bc extensions waclinstall preGeneratedJs clean distclean tclprep reset install uninstall tkprep tkconfig tkinstall tkclean


all: wacl.js

wacl.js: wacl.bc extensions preGeneratedJs
	emcc $(WASMFLAGS) $(WACLEXPORTS) $(WASMLIBS) -o $@

wacl.bc:
	cd tcl/unix && emmake make -j

waclinstall: wacl.bc
	cd tcl/unix && make install
	
extensions: waclinstall
	cd ext && if [ ! -e tdom/Makefile ] ; then make tdomconfig ; fi && make tdominstall
	cd ext && if [ ! -e rl_json/Makefile ] ; then make rljsonconfig ; fi && make rljsoninstall

library:
	mkdir -p library
	cp -r $(INSTALLDIR)/lib/tcl8* library/
	cd ext && if [ ! -e tcllib* ] ; then make tcllibprep ; fi && make tcllib
	
preGeneratedJs: library
	python3 $(EMSCRIPTEN)/tools/file_packager.py wacl-library.data --preload library@/usr/lib/ | tail -n +5 > library.js
	python3 $(EMSCRIPTEN)/tools/file_packager.py wacl-custom.data --preload custom@/usr/lib/ | tail -n +5 > custom.js
	cat js/preJsRequire.js library.js custom.js > preGeneratedJs.js
	rm -f library.js custom.js

waclprep:
	wget -nc http://prdownloads.sourceforge.net/tcl/tcl-core$(TCLVERSION)-src.tar.gz
	mkdir -p tcl
	tar -C tcl --strip-components=1 -xf tcl-core$(TCLVERSION)-src.tar.gz
	cd tcl && patch --verbose -p1 < ../wacl.patch
	cd tcl/unix && autoconf
	cd ext && make tdomprep
	cd ext && make rljsonprep
	cd ext && make tcllibprep

# ---- Tk ---------------------------------------------------------------
# Stock Tk 8.6 against em-x11's Xlib. Tk's internal xlib/*.c is only used
# for Aqua builds (see unix/Makefile.in AQUA_OBJS), so --with-x keeps it
# out of the compile -- all X symbols stay unresolved in libtk.a and get
# filled by libemx11.a at demo link time. Prerequisites: waclinstall
# must have produced $(INSTALLDIR)/lib/libtcl8.6.a first, and em-x11
# must have been built (EMX11_LIBDIR exists) at least for the header tree.

tkprep:
	wget -nc http://prdownloads.sourceforge.net/tcl/tk$(TKVERSION)-src.tar.gz
	mkdir -p tk
	tar -C tk --strip-components=1 -xf tk$(TKVERSION)-src.tar.gz
	cd tk/unix && autoconf

tkconfig:
	@test -d "$(EMX11_INCLUDES)/X11" || \
		(echo "em-x11 headers not found at $(EMX11_INCLUDES)/X11"; exit 1)
	cd tk/unix && emconfigure ./configure --prefix=$(CURDIR)/$(INSTALLDIR) \
		--with-tcl=$(CURDIR)/$(INSTALLDIR)/lib \
		--x-includes=$(EMX11_INCLUDES) \
		--x-libraries=$(EMX11_LIBDIR) \
		--disable-shared --disable-load --disable-threads \
		--disable-xft
	# Strip optimisation flags the configure injects (same hack as Tcl's
	# config target) and make sure em-x11 headers win over anything the
	# configure probe stuck into X11_INCLUDES.
	cd tk/unix && sed -i 's/-O2//g' Makefile
	cd tk/unix && sed -i 's|^\(CFLAGS[[:space:]].*\)|\1 $(BCFLAGS)|g' Makefile
	cd tk/unix && sed -i 's|^X11_INCLUDES[[:space:]]*=.*|X11_INCLUDES = -I$(EMX11_INCLUDES)|' Makefile

libtk: tkconfig
	cd tk/unix && emmake make -j libtk8.6.a libtkstub8.6.a

# Install just the pieces a downstream demo needs: the static archives
# and the header tree. Skip Tk's install-binaries because it transitively
# builds wish, which wants libemx11 at link time -- wish only makes sense
# in a page with a Canvas attached, so we build that at the demo layer.
tkinstall: libtk
	mkdir -p $(INSTALLDIR)/lib $(INSTALLDIR)/include/tk
	cp tk/unix/libtk8.6.a tk/unix/libtkstub8.6.a $(INSTALLDIR)/lib/
	cp tk/unix/tkConfig.sh $(INSTALLDIR)/lib/
	cp tk/generic/tk.h tk/generic/tkDecls.h tk/generic/tkPlatDecls.h \
		tk/generic/tkIntXlibDecls.h $(INSTALLDIR)/include/tk/ 2>/dev/null || true
	cp tk/generic/*.h $(INSTALLDIR)/include/tk/

tkclean:
	if [ -e tk/unix/Makefile ] ; then cd tk/unix && make distclean ; fi
	rm -f $(INSTALLDIR)/lib/libtk8.6.a $(INSTALLDIR)/lib/tkConfig.sh
# -----------------------------------------------------------------------

config:
	mkdir -p $(INSTALLDIR)
	cd tcl/unix && emconfigure ./configure --prefix=$(CURDIR)/$(INSTALLDIR) \
		--disable-threads --disable-load --disable-shared
	cd tcl/unix && sed -i 's/-O2//g' Makefile
	cd tcl/unix && sed -i 's/^\(CFLAGS\t.*\)/\1 $(BCFLAGS)/g' Makefile

install:
	mkdir -p www/js/tcl/
	cp wacl.{js,wasm} ecky-l.github.io/wacl/js/tcl/
	cp wacl-{library,custom}.data ecky-l.github.io/wacl/js/tcl/

package: install
	cd www && zip -r ../wacl.zip *
	
clean:
	rm -rf library wacl.js* *.data *.wasm *.js wacl.zip $(INSTALLDIR) 
	cd tcl/unix && make clean
	cd ext && make tdomclean

distclean:
	rm -rf library wacl.js* *.data *wasm *.js wacl.zip $(INSTALLDIR)
	if [ -e tcl/unix/Makefile ] ; then cd tcl/unix && make distclean ; fi
	cd ext && make tdomdistclean
	cd ext && make rljsondistclean

patch:
	wget -nc http://prdownloads.sourceforge.net/tcl/tcl-core$(TCLVERSION)-src.tar.gz
	tar -xzf tcl-core$(TCLVERSION)-src.tar.gz
	rm -rf tcl/unix/{autom4te.cache,configure} tcl$(TCLVERSION)/unix/configure
	echo `diff -ruN tcl$(TCLVERSION) tcl > wacl.patch`
	rm -rf tcl$(TCLVERSION)

reset:
	@read -p "This nukes anything in ./tcl/, are you sure? Type 'YES I am sure' if so: " P && [ "$$P" = "YES I am sure" ]
	rm -rf tcl $(INSTALLDIR) wacl.js* preGeneratedJs.js

