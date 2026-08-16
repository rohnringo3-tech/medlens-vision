# Install script for directory: C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/opencv

# Set the install prefix
if(NOT DEFINED CMAKE_INSTALL_PREFIX)
  set(CMAKE_INSTALL_PREFIX "/usr/local")
endif()
string(REGEX REPLACE "/$" "" CMAKE_INSTALL_PREFIX "${CMAKE_INSTALL_PREFIX}")

# Set the install configuration name.
if(NOT DEFINED CMAKE_INSTALL_CONFIG_NAME)
  if(BUILD_TYPE)
    string(REGEX REPLACE "^[^A-Za-z0-9_]+" ""
           CMAKE_INSTALL_CONFIG_NAME "${BUILD_TYPE}")
  else()
    set(CMAKE_INSTALL_CONFIG_NAME "Release")
  endif()
  message(STATUS "Install configuration: \"${CMAKE_INSTALL_CONFIG_NAME}\"")
endif()

# Set the component getting installed.
if(NOT CMAKE_INSTALL_COMPONENT)
  if(COMPONENT)
    message(STATUS "Install component: \"${COMPONENT}\"")
    set(CMAKE_INSTALL_COMPONENT "${COMPONENT}")
  else()
    set(CMAKE_INSTALL_COMPONENT)
  endif()
endif()

# Is this installation the result of a crosscompile?
if(NOT DEFINED CMAKE_CROSSCOMPILING)
  set(CMAKE_CROSSCOMPILING "TRUE")
endif()

# Set path to fallback-tool for dependency-resolution.
if(NOT DEFINED CMAKE_OBJDUMP)
  set(CMAKE_OBJDUMP "CMAKE_OBJDUMP-NOTFOUND")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "licenses" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/share/licenses/opencv5" TYPE FILE RENAME "dlpack-LICENSE" FILES "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/opencv/3rdparty/dlpack/LICENSE")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "licenses" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/share/licenses/opencv5" TYPE FILE RENAME "flatbuffers-LICENSE.txt" FILES "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/opencv/3rdparty/flatbuffers/LICENSE.txt")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "dev" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/include/opencv5/opencv2" TYPE FILE FILES "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/cvconfig.h")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "dev" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/include/opencv5/opencv2" TYPE FILE FILES "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/opencv2/opencv_modules.hpp")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "dev" OR NOT CMAKE_INSTALL_COMPONENT)
  if(EXISTS "$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/lib/cmake/opencv5/OpenCVModules.cmake")
    file(DIFFERENT _cmake_export_file_changed FILES
         "$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/lib/cmake/opencv5/OpenCVModules.cmake"
         "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/CMakeFiles/Export/c090bfb35398b9d2683ade08d20c938a/OpenCVModules.cmake")
    if(_cmake_export_file_changed)
      file(GLOB _cmake_old_config_files "$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/lib/cmake/opencv5/OpenCVModules-*.cmake")
      if(_cmake_old_config_files)
        string(REPLACE ";" ", " _cmake_old_config_files_text "${_cmake_old_config_files}")
        message(STATUS "Old export file \"$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/lib/cmake/opencv5/OpenCVModules.cmake\" will be replaced.  Removing files [${_cmake_old_config_files_text}].")
        unset(_cmake_old_config_files_text)
        file(REMOVE ${_cmake_old_config_files})
      endif()
      unset(_cmake_old_config_files)
    endif()
    unset(_cmake_export_file_changed)
  endif()
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/opencv5" TYPE FILE FILES "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/CMakeFiles/Export/c090bfb35398b9d2683ade08d20c938a/OpenCVModules.cmake")
  if(CMAKE_INSTALL_CONFIG_NAME MATCHES "^([Rr][Ee][Ll][Ee][Aa][Ss][Ee])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/opencv5" TYPE FILE FILES "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/CMakeFiles/Export/c090bfb35398b9d2683ade08d20c938a/OpenCVModules-release.cmake")
  endif()
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "dev" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/opencv5" TYPE FILE FILES
    "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/unix-install/OpenCVConfig-version.cmake"
    "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/unix-install/OpenCVConfig.cmake"
    )
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "scripts" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/bin" TYPE FILE PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ WORLD_EXECUTE FILES "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/CMakeFiles/install/setup_vars_opencv5.sh")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "dev" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/share/opencv5" TYPE FILE FILES
    "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/opencv/platforms/scripts/valgrind.supp"
    "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/opencv/platforms/scripts/valgrind_3rdparty.supp"
    )
endif()

if(NOT CMAKE_INSTALL_LOCAL_ONLY)
  # Include the install script for each subdirectory.
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/3rdparty/zlib/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/3rdparty/harfbuzz/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/3rdparty/protobuf/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/include/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/calib/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/core/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/dnn/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/features/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/flann/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/geometry/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/highgui/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/imgcodecs/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/imgproc/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/java/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/js/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/objc/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/objdetect/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/photo/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/ptcloud/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/python/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/stereo/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/stitching/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/ts/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/video/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/videoio/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/.firstpass/world/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/core/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/flann/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/geometry/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/imgproc/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/photo/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/python_tests/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/stereo/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/dnn/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/features/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/objdetect/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/video/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/calib/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/java_bindings_generator/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/js_bindings_generator/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/objc_bindings_generator/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/python_bindings_generator/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/modules/js/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/doc/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/docs_sphinx/cmake_install.cmake")
  include("C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/samples/cmake_install.cmake")

endif()

string(REPLACE ";" "\n" CMAKE_INSTALL_MANIFEST_CONTENT
       "${CMAKE_INSTALL_MANIFEST_FILES}")
if(CMAKE_INSTALL_LOCAL_ONLY)
  file(WRITE "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/install_local_manifest.txt"
     "${CMAKE_INSTALL_MANIFEST_CONTENT}")
endif()
if(CMAKE_INSTALL_COMPONENT)
  if(CMAKE_INSTALL_COMPONENT MATCHES "^[a-zA-Z0-9_.+-]+$")
    set(CMAKE_INSTALL_MANIFEST "install_manifest_${CMAKE_INSTALL_COMPONENT}.txt")
  else()
    string(MD5 CMAKE_INST_COMP_HASH "${CMAKE_INSTALL_COMPONENT}")
    set(CMAKE_INSTALL_MANIFEST "install_manifest_${CMAKE_INST_COMP_HASH}.txt")
    unset(CMAKE_INST_COMP_HASH)
  endif()
else()
  set(CMAKE_INSTALL_MANIFEST "install_manifest.txt")
endif()

if(NOT CMAKE_INSTALL_LOCAL_ONLY)
  file(WRITE "C:/Users/LEGION/Desktop/MedLens Vision/opencv5-build/build_js/${CMAKE_INSTALL_MANIFEST}"
     "${CMAKE_INSTALL_MANIFEST_CONTENT}")
endif()
