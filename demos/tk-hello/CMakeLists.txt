# tk-hello: composes wacl-tk's Tcl+Tk archives with em-x11's Xlib surface.
#
# em-x11 is a sibling project. We pick up its prebuilt archive and JS
# bindings from em-x11/build/artifacts/ and em-x11/src/bindings/. wacl-tk's
# own Tcl+Tk archives come from jsbuild/ (produced by `make tkinstall`).
# If either piece is missing we skip this target rather than failing the
# whole wacl-tk-demos build.

set(WACL_TK_DIR "${CMAKE_SOURCE_DIR}/jsbuild")
set(TCL_ARCHIVE "${WACL_TK_DIR}/lib/libtcl8.6.a")
set(TK_ARCHIVE  "${WACL_TK_DIR}/lib/libtk8.6.a")

# Tcl/Tk script libraries live in the wacl-tk source tree. The Tcl side
# must be the source's `tcl/library/` (which has tclIndex for
# auto-loading); wacl's own `library/tcl8.6/` is a curated subset packed
# for the wacl.js bundle and is missing tclIndex.
set(TCL_LIBRARY_DIR "${CMAKE_SOURCE_DIR}/tcl/library")
set(TK_LIBRARY_DIR  "${CMAKE_SOURCE_DIR}/tk/library")

# em-x11 outputs (built via `pnpm build:native` in ../em-x11).
set(EMX11_DIR      "${CMAKE_SOURCE_DIR}/../em-x11")
set(EMX11_ARCHIVE  "${EMX11_DIR}/build/artifacts/libemx11.a")
set(EMX11_INCLUDE  "${EMX11_DIR}/native/include")
set(EMX11_JS_LIB_DIR "${EMX11_DIR}/src/bindings")
set(EMX11_JS_LIBS
    core.js
    window.js
    property.js
    atom.js
    draw.js
    font.js
    pixmap.js
    clipboard.js
)

if(NOT EXISTS "${TCL_ARCHIVE}" OR NOT EXISTS "${TK_ARCHIVE}")
    message(STATUS "tk-hello: skipping -- ${TCL_ARCHIVE} or ${TK_ARCHIVE} missing. "
                   "Run `make tkinstall` in wacl-tk first.")
    return()
endif()
if(NOT EXISTS "${TCL_LIBRARY_DIR}/init.tcl" OR NOT EXISTS "${TK_LIBRARY_DIR}/tk.tcl")
    message(STATUS "tk-hello: skipping -- Tcl/Tk script library missing.")
    return()
endif()
if(NOT EXISTS "${EMX11_ARCHIVE}")
    message(STATUS "tk-hello: skipping -- em-x11 archive missing at ${EMX11_ARCHIVE}. "
                   "Run `pnpm build:native` in ../em-x11 first.")
    return()
endif()
foreach(_jslib IN LISTS EMX11_JS_LIBS)
    if(NOT EXISTS "${EMX11_JS_LIB_DIR}/${_jslib}")
        message(STATUS "tk-hello: skipping -- em-x11 JS binding missing: ${EMX11_JS_LIB_DIR}/${_jslib}")
        return()
    endif()
endforeach()

add_executable(tk-hello tk-hello.c)

# Tcl/Tk headers live side-by-side under the wacl-tk jsbuild tree;
# em-x11 headers come from its native/include/.
target_include_directories(tk-hello PRIVATE
    "${WACL_TK_DIR}/include"
    "${WACL_TK_DIR}/include/tk"
    "${EMX11_INCLUDE}"
)

# Link order: Tk depends on Tcl for its symbols; both depend on em-x11
# for the Xlib surface. emcc resolves static archives left-to-right, so
# Tk must come first.
target_link_libraries(tk-hello PRIVATE
    "${TK_ARCHIVE}"
    "${TCL_ARCHIVE}"
    "${EMX11_ARCHIVE}"
)

target_compile_options(tk-hello PRIVATE ${WACL_TK_WARN_FLAGS})

# em-x11's emx11_static target used to propagate --js-library via INTERFACE
# link options. Since we consume the archive directly (no CMake target),
# we respecify the JS library here.
target_link_options(tk-hello PRIVATE
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s EXPORT_NAME=createTkHelloModule"
    "SHELL:-s ASYNCIFY=1"
    "SHELL:-s ENVIRONMENT=web"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s FORCE_FILESYSTEM=1"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString']"
    "SHELL:-s EXPORTED_FUNCTIONS=['_main','_emx11_push_button_event','_emx11_push_motion_event','_emx11_push_key_event','_emx11_push_expose_event','_emx11_push_map_request']"
    "SHELL:-Wl,--error-limit=0"
    "SHELL:--preload-file ${TCL_LIBRARY_DIR}@/tcl"
    "SHELL:--preload-file ${TK_LIBRARY_DIR}@/tk"
)
foreach(_jslib IN LISTS EMX11_JS_LIBS)
    target_link_options(tk-hello PRIVATE
        "SHELL:--js-library ${EMX11_JS_LIB_DIR}/${_jslib}"
    )
endforeach()

set_target_properties(tk-hello PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/artifacts/tk-hello"
)
