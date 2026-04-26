cmake_minimum_required(VERSION 3.20)
project(wacl-tk-demos C)

# Enforce Emscripten toolchain -- mirrors em-x11's check so running bare cmake
# fails loudly instead of producing a nonsensical native build.
if(NOT EMSCRIPTEN)
    message(FATAL_ERROR
        "wacl-tk-demos must be configured through emcmake. "
        "From inside WSL / Linux: emcmake cmake -S . -B build")
endif()

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Artifacts land under build/artifacts/<demo>/ so Vite's fs.allow('build')
# can serve them from the dev server.
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/artifacts")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/artifacts")
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/artifacts")

set(WACL_TK_WARN_FLAGS -Wall -Wextra -Wno-unused-parameter)

add_subdirectory(demos/tk-hello)
