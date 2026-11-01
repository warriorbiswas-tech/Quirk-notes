cmake_minimum_required(VERSION 3.22.1)
project(quirk C CXX)

include(FetchContent)

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)

# v0.8.0, pinned so what runs is what was tested.
FetchContent_Declare(llama URL https://github.com/ggml-org/llama.cpp/archive/8642541b255bfb5dc39cd351a178be09013a55d6.tar.gz)
FetchContent_MakeAvailable(llama)

# The engine is shared with the iPad app, which finds this header as <llama/llama.h>.
file(COPY ${llama_SOURCE_DIR}/include/llama.h DESTINATION ${CMAKE_BINARY_DIR}/shim/llama)

set(ENGINE ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../ios/Margin)
add_library(quirk SHARED jni.c ${ENGINE}/LlamaEngine.c)
target_include_directories(quirk PRIVATE ${CMAKE_BINARY_DIR}/shim ${ENGINE})
target_link_libraries(quirk PRIVATE llama log)
target_link_options(quirk PRIVATE "-Wl,-z,max-page-size=16384")
