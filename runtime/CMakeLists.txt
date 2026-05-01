# wacl-tk-runtime: the generic Tk wasm that the JS API drives.
#
# Mirrors demos/tk-hello/CMakeLists.txt's prereq guards but builds a
# headless runtime: no hardcoded Tcl script, all evaluation comes from
# JS via cwrap'd entry points.

set(WACL_TK_DIR "${CMAKE_SOURCE_DIR}/jsbuild")
set(TCL_ARCHIVE "${WACL_TK_DIR}/lib/libtcl8.6.a")
set(TK_ARCHIVE  "${WACL_TK_DIR}/lib/libtk8.6.a")

set(TCL_LIBRARY_DIR "${CMAKE_SOURCE_DIR}/tcl/library")
set(TK_LIBRARY_DIR  "${CMAKE_SOURCE_DIR}/tk/library")

set(EMX11_DIR     "${CMAKE_SOURCE_DIR}/../em-x11")
set(EMX11_ARCHIVE "${EMX11_DIR}/build/artifacts/libemx11.a")
set(EMX11_INCLUDE "${EMX11_DIR}/native/include")

# em-x11's JS bridges are now embedded in libemx11.a via EM_JS (see
# em-x11/native/src/bridges.c). No --js-library wiring needed: the
# archive carries its own __em_js__* data symbols that emcc's post-link
# pass picks up. Keep the prereq guards on the archive itself.

if(NOT EXISTS "${TCL_ARCHIVE}" OR NOT EXISTS "${TK_ARCHIVE}")
    message(STATUS "wacl-tk-runtime: skipping -- ${TCL_ARCHIVE} or ${TK_ARCHIVE} missing.")
    return()
endif()
if(NOT EXISTS "${TCL_LIBRARY_DIR}/init.tcl" OR NOT EXISTS "${TK_LIBRARY_DIR}/tk.tcl")
    message(STATUS "wacl-tk-runtime: skipping -- Tcl/Tk script library missing.")
    return()
endif()
if(NOT EXISTS "${EMX11_ARCHIVE}")
    message(STATUS "wacl-tk-runtime: skipping -- em-x11 archive missing at ${EMX11_ARCHIVE}.")
    return()
endif()

add_executable(wacl-tk-runtime wacl-tk-runtime.c)

target_include_directories(wacl-tk-runtime PRIVATE
    "${WACL_TK_DIR}/include"
    "${WACL_TK_DIR}/include/tk"
    "${EMX11_INCLUDE}"
)

target_link_libraries(wacl-tk-runtime PRIVATE
    "${TK_ARCHIVE}"
    "${TCL_ARCHIVE}"
    "${EMX11_ARCHIVE}"
)

target_compile_options(wacl-tk-runtime PRIVATE ${WACL_TK_WARN_FLAGS})

target_link_options(wacl-tk-runtime PRIVATE
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s EXPORT_NAME=createWaclTkRuntime"
    "SHELL:-s ASYNCIFY=1"
    "SHELL:-s ENVIRONMENT=web"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s FORCE_FILESYSTEM=1"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','FS','stringToUTF8','lengthBytesUTF8']"
    "SHELL:-s EXPORTED_FUNCTIONS=['_main','_wacl_eval','_wacl_result','_wacl_get_var','_wacl_set_var','_wacl_do_one_event','_emx11_push_button_event','_emx11_push_motion_event','_emx11_push_key_event','_emx11_push_expose_event','_emx11_push_map_request','_emx11_push_reparent_notify','_malloc','_free']"
    "SHELL:-Wl,--error-limit=0"
    "SHELL:--preload-file ${TCL_LIBRARY_DIR}@/tcl"
    "SHELL:--preload-file ${TK_LIBRARY_DIR}@/tk"
)

set_target_properties(wacl-tk-runtime PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/artifacts/wacl-tk-runtime"
)
