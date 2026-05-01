# Build Tcl + Tk static archives for the wacl-tk-runtime cmake target.
#
# This Makefile is *only* the prep stage: download Tcl/Tk source, run their
# autoconf/configure under emconfigure, and produce libtcl8.6.a / libtk8.6.a
# under jsbuild/lib. The actual wasm runtime is built by `pnpm build:native`
# (cmake -> runtime/CMakeLists.txt), which links those archives plus
# libemx11.a.
#
# Live targets (per setup.sh):
#   waclprep    download + patch Tcl source
#   tkprep      download Tk source
#   config      configure Tcl
#   waclinstall build + install libtcl
#   tkinstall   build + install libtk (depends on em-x11 headers)
#   patch       regenerate wacl.patch from a clean Tcl checkout (maintainer)
#   clean / distclean
#
# Tcl/Tk version pins -- bump together; em-x11's X11/*.h is matched to 8.6.
TCLVERSION?=8.6.6
TKVERSION?=8.6.6

INSTALLDIR=jsbuild
EMSCRIPTEN?=$(HOME)/.local/lib/emsdk/upstream/emscripten

# em-x11 Xlib replacement: Tk is compiled against em-x11's X11/*.h. The
# header dir must contain an X11/ subtree (matching Xlib's expected layout).
EMX11_DIR?=$(CURDIR)/../em-x11
EMX11_INCLUDES=$(EMX11_DIR)/native/include
EMX11_LIBDIR=$(EMX11_DIR)/build/artifacts

# Optimisation injected into the Tcl/Tk Makefiles after configure runs.
BCFLAGS?=-Oz -s WASM=1

.PHONY: waclprep config waclinstall tkprep tkconfig libtk tkinstall tkclean patch clean distclean reset

waclprep:
	wget -nc http://prdownloads.sourceforge.net/tcl/tcl-core$(TCLVERSION)-src.tar.gz
	mkdir -p tcl
	tar -C tcl --strip-components=1 -xf tcl-core$(TCLVERSION)-src.tar.gz
	cd tcl && patch --verbose -p1 < ../wacl.patch
	cd tcl/unix && autoconf

config:
	mkdir -p $(INSTALLDIR)
	cd tcl/unix && emconfigure ./configure --prefix=$(CURDIR)/$(INSTALLDIR) \
		--disable-threads --disable-load --disable-shared
	cd tcl/unix && sed -i 's/-O2//g' Makefile
	cd tcl/unix && sed -i 's/^\(CFLAGS\t.*\)/\1 $(BCFLAGS)/g' Makefile

waclinstall:
	cd tcl/unix && emmake make -j
	cd tcl/unix && make install

# ---- Tk ---------------------------------------------------------------
# Stock Tk 8.6 against em-x11's Xlib. Tk's internal xlib/*.c is only used
# for Aqua builds (see unix/Makefile.in AQUA_OBJS), so --with-x keeps it
# out of the compile -- all X symbols stay unresolved in libtk.a and get
# filled by libemx11.a at runtime link time. Prerequisites: waclinstall
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

# Install just the pieces the cmake runtime needs: the static archives
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

# Maintainer escape hatch: regenerate wacl.patch by diffing a fresh Tcl
# source against the patched ./tcl/ tree. Only needed when bumping
# TCLVERSION or upstreaming a fix.
patch:
	wget -nc http://prdownloads.sourceforge.net/tcl/tcl-core$(TCLVERSION)-src.tar.gz
	tar -xzf tcl-core$(TCLVERSION)-src.tar.gz
	rm -rf tcl/unix/{autom4te.cache,configure} tcl$(TCLVERSION)/unix/configure
	echo `diff -ruN tcl$(TCLVERSION) tcl > wacl.patch`
	rm -rf tcl$(TCLVERSION)

clean:
	rm -rf $(INSTALLDIR)
	if [ -e tcl/unix/Makefile ] ; then cd tcl/unix && make clean ; fi
	if [ -e tk/unix/Makefile ] ; then cd tk/unix && make clean ; fi

distclean:
	rm -rf $(INSTALLDIR)
	if [ -e tcl/unix/Makefile ] ; then cd tcl/unix && make distclean ; fi
	if [ -e tk/unix/Makefile ] ; then cd tk/unix && make distclean ; fi

reset:
	@read -p "This nukes anything in ./tcl/ and ./tk/, are you sure? Type 'YES I am sure' if so: " P && [ "$$P" = "YES I am sure" ]
	rm -rf tcl tk $(INSTALLDIR)
